'use strict';

const AWS = require('aws-sdk');

// Get config
const config = require('../../config/s3-config.js');

/**
 * Helper class assists with processing read streams
 */
class ReadStreamHandler {
  /**
   * Constructor takes a readable stream and prepares local variables
   *
   * @param {ReadableStream} readStream Readable Stream that will be processed
   */
  constructor(readStream) {
    /**
     * The stream that is being processed
     */
    this.stream = readStream;

    /**
     * The maximum number of Bytes allowed per chunk
     */
    this.max = config.MAX_BYTES;

    /**
     * Array of chunks that are currently being processed into one large chunk
     */
    this.chunkList = [];

    /**
     * If the provided stream is closed. When a read stream is finished it will
     * automatically be destroyed and this value will be set to true
     */
    this.closed = false;

    // Explicitly pause the stream
    this.stream.pause();

    // Set up stream listeners
    this.stream.on('end', () => {
      // The stream is done. Destroy it
      this.stream.destroy();
      this.closed = true;
    });
  }

  /**
   * Gets the current size of all of the chunks in the chunk list
   *
   * @return {number} Current size of chunks in bytes
   */
  get currentChunkSize() {
    return this.chunkList.reduce((acc, buff) => acc + buff.length, 0);
  }

  /**
   * Attempts to get the next chunk of size `max` from the read stream. Will
   * resolve with 'null' if there is no more data left to consume
   *
   * If there is less data in the stream than `max`, a buffer will be resolved
   * with length equal to the remaining data in the stream
   */
  async getNextChunk() {
    // Return null if the stream is already closed
    if (this.closed) return null;

    // Perform remaining operations within a promise so that we can resolve at
    // a moment of our choosing
    return new Promise((resolve, reject) => {
      // Set up the 'data' listener
      const onData = (chunk) => {
        this.chunkList.push(chunk);

        // Special case
        if (this.currentChunkSize === this.max) {
          // If, somehow, the current chunk size is exactly the maximum, skip
          // extra processing and resolve the concatenation
          const concatBuff = Buffer.concat(this.chunkList);
          this.stream.removeListener('data', onData);
          this.stream.removeListener('end', onEnd);
          this.chunkList = [];

          return resolve(concatBuff);
        }

        // Continue processing as normal if we aren't over our maximum chunk size
        if (this.currentChunkSize <= this.max) return;

        // Otherwise we need to return a buffer with exactly as much data as the
        // maximum chunk size. Begin by concatenating all current chunks
        const concatBuff = Buffer.concat(this.chunkList);

        // Slice any extra data off the top and unshift back into the stream
        const retBuffer = concatBuff.slice(0, this.max);
        const unshiftBuff = concatBuff.slice(this.max);

        // Pause the stream
        this.stream.pause();

        // Remove event listeners
        this.stream.removeListener('data', onData);
        this.stream.removeListener('end', onEnd);

        // Unshift data _after_ removing event listeners and pausing
        this.stream.unshift(unshiftBuff);

        // Reset the chunk list
        this.chunkList = [];

        return resolve(retBuffer);
      };
      this.stream.on('data', onData);

      // Set up a special 'end' listener in case we reach the end of our stream
      const onEnd = () => {
        // Remove listeners
        this.stream.removeListener('data', onData);
        this.stream.removeListener('end', onEnd);

        // Special case: No data available
        if (this.chunkList.length === 0) {
          return resolve(null);
        }

        // If this was hit, it means we no longer have any data to read,
        // resolve the concatenation of all the chunks we have
        const concatBuff = Buffer.concat(this.chunkList);

        // Clean the chunk list
        this.chunkList = [];

        return resolve(concatBuff);
      };
      this.stream.on('end', onEnd);
      // Resume the stream
      this.stream.resume();
    });
  }
}

/**
 * This class simplifies interactions with S3
 */
class S3 {
  /**
   * Constructor takes options that are then passed to the AWS.S3 constructor
   *
   * @param {object} opts Options passed to the AWS.S3 constructor
   */
  constructor(opts) {
    this.s3 = new AWS.S3(opts);
  }

  /**
   * Retrieves an object from S3
   *
   * @param {string} bucket Name of the bucket to retrieve the object from
   * @param {string} objectKey Name of the object to retrieve
   *
   * @return {Promise} Promise resolves with data, rejects with error
   **/
  async getS3Object(bucket, objectKey) {
    const params = {
      Bucket: bucket,
      Key: objectKey
    };
    return new Promise((resolve, reject) => {
      this.s3.getObject(params, (err, data) => {
        if (err) return reject(err);
        return resolve(data);
      });
    });
  };

  /**
   * Puts an object into S3
   *
   * @param {buffer} body Buffer contents to upload to S3
   * @param {string} bucket The name of the bucket to put the object
   * @param {string} objectKey Name of the object, including file paths
   *
   * @return {Promise} Promise resolved on success, rejects on error
   **/
  async putS3Object(body, bucket, objectKey) {
    const params = {
      Body: body,
      Bucket: bucket,
      Key: objectKey
    };

    // HTML files require the correct content type
    if (/\.html$/.test(objectKey)) {
      params.ContentType = 'text/html';
    }

    console.log(`Uploading file: ${objectKey}`);
    return new Promise((resolve, reject) => {
      this.s3.putObject(params, (err, data) => {
        if (err) return reject(err);
        console.group();
        console.log(`Finished Uploading File: ${objectKey}`);
        console.groupEnd();
        return resolve(data);
      });
    });
  };

  /**
   * Takes a readable stream and uploads the contents of that stream to S3 using
   * the "multi-part" upload scheme if needed
   *
   * @param {ReadableStream} readStream Stream to ingest
   * @param {string} bucket Name of the bucket to upload data to
   * @param {string} objectKey Name of the final object being uploaded
   * @param {number} [filesize] Optional: Size of the file being uploaded in bytes,
   *                            used for debugging purposes
   */
  async putS3Stream(readStream, bucket, objectKey, filesize=null) {
    const streamHandler = new ReadStreamHandler(readStream);
    let chunk = await streamHandler.getNextChunk();
    if (chunk.length < streamHandler.max) {
      // If the length of the first chunk is less than the maximum then the entire
      // file is within this single chunk. Upload normally
      return this.putS3Object(chunk, bucket, objectKey);
    }

    // Otherwise we need to upload in parts
    const predictedChunks = Math.ceil(filesize / config.MAX_BYTES);
    const predictedBatches = Math.ceil(predictedChunks / config.MAX_CONCURRENT);
    console.log(`Uploading File: ${objectKey} in ${predictedChunks} chunks over ${predictedBatches} batches`);
    const initializationData = await this.createMultipartUpload(bucket, objectKey);
    const uploadId = initializationData.UploadId;
    let parts = [];
    let batchCount = 1;
    try {
      let uploadPromises = [];
      let partNumber = 1;
      while (chunk) {
        uploadPromises.push(this.uploadPart(chunk, bucket, objectKey, partNumber, uploadId));
        partNumber += 1;

        if (uploadPromises.length >= config.MAX_CONCURRENT) {
          // Wait for the current batch of promises to finish before continuing
          console.group();
          console.group();
          console.log(`${objectKey}: Uploading batch ${batchCount}/${predictedBatches}`);
          console.groupEnd();
          console.groupEnd();
          batchCount += 1;
          parts = parts.concat(await Promise.all(uploadPromises));
          uploadPromises = [];
        }

        chunk = await streamHandler.getNextChunk();
      }

      // Wait for any remaining promises
      if (uploadPromises.length) {
        console.group();
        console.group();
        console.log(`${objectKey}: Uploading batch ${batchCount}/${predictedBatches} (final)`);
        console.groupEnd();
        console.groupEnd();
        parts = parts.concat(await Promise.all(uploadPromises));
      }

      // Because of the nature of Promise.all and Array.concat, the `parts` array
      // is guaranteed to be in sequential order. Add the part number to each part
      parts = parts.map((part, index) => {
        part.PartNumber = index + 1;

        // Delete the "ServerSideEncryption" member
        delete part.ServerSideEncryption;
        return part;
      });
    } catch (e) {
      // If an error happens at any time, abort the upload and throw the original error
      await this.abortMultipartUpload(bucket, objectKey, initializationData.UploadId);
      throw e;
    }

    // Finally, complete the upload!
    await this.completeMultipartUpload(bucket, objectKey, parts, uploadId);
    console.group();
    console.log(`Finished Uploading File: ${objectKey}`);
    console.groupEnd();
  }

  /**
   * Initiates a multi-part upload
   *
   * @param {string} bucket The bucket to upload to
   * @param {string} key Object key for the object being uploaded
   *
   * @return {Promise} Resolves with response from S3
   */
  async createMultipartUpload(bucket, key) {
    const params = {
      Bucket: bucket,
      Key: key
    };
    return new Promise((resolve, reject) => {
      this.s3.createMultipartUpload(params, (err, res) => {
        if (err) return reject(err);
        resolve(res);
      });
    });
  }

  /**
   * Uploads a single part of a multi-part upload
   *
   * @param {buffer} body Data to upload
   * @param {string} bucket The bucket to upload to
   * @param {string} key Object key for the object being uploaded
   * @param {number} part The part number (beginning with 1)
   * @param {string} uploadId The Upload ID provided on initiation
   *
   * @return {Promise} Resolves with response from S3
   */
  async uploadPart(body, bucket, key, part, uploadId) {
    const params = {
      Body: body,
      Bucket: bucket,
      Key: key,
      PartNumber: part,
      UploadId: uploadId
    };
    return new Promise((resolve, reject) => {
      this.s3.uploadPart(params, (err, res) => {
        if (err) return reject(err);
        resolve(res);
      });
    });
  }

  /**
   * Completes a multi-part upload
   *
   * @param {string} bucket The bucket to upload to
   * @param {string} key Object key for the object being uploaded
   * @param {object[]} parts Array of part objects, each element should be an
   *                         object with `ETag` and `PartNumber` members
   * @param {string} uploadId The Upload ID provided on initiation
   *
   * @return {Promise} Resolves with response from S3
   */
  async completeMultipartUpload(bucket, key, parts, uploadId) {
    const params = {
      Bucket: bucket,
      Key: key,
      MultipartUpload: {
        Parts: parts
      },
      UploadId: uploadId
    };
    return new Promise((resolve, reject) => {
      this.s3.completeMultipartUpload(params, (err, res) => {
        if (err) return reject(err);
        resolve(res);
      });
    });
  }

  /**
   * Cancels a multi-part upload
   *
   * @param {string} bucket The bucket to upload to
   * @param {string} key Object key for the object being uploaded
   * @param {string} uploadId The Upload ID provided on initiation
   *
   * @return {Promise} Resolves with response from S3
   */
  async abortMultipartUpload(bucket, key, uploadId) {
    const params = {
      Bucket: bucket,
      Key: key,
      UploadId: uploadId
    };
    return new Promise((resolve, reject) => {
      this.s3.abortMultipartUpload(params, (err, res) => {
        if (err) return reject(err);
        resolve(res);
      });
    });
  }

  /**
   * Gets all of the objects in a given bucket
   *
   * @param {string} bucket Name of the bucket to list objects from
   *
   * @return {Promise} Promise will resolve with an array of keys or reject with error
   **/
  async getS3ObjectList(bucket) {
    const params = {
      Bucket: bucket
    };
    return new Promise((resolve, reject) => {
      this.s3.listObjects(params, (err, res) => {
        if (err) return reject(err);

        // Just return object keys
        const fileNames = res.Contents.map((content) => {
          return content.Key;
        });
        return resolve(fileNames);
      });
    });
  };

  /**
   * Deletes the specified objects in the specified bucket
   *
   * @param {string} bucket Name of the bucket to delete items from
   * @param {string[]} objectKeys array of object keys to delete
   *
   * @return {Promise} Resolves on success, rejects with error
   **/
  async deleteS3Objects(bucket, objectKeys) {
    const params = {
      Bucket: bucket,
      Delete: {
        Objects: objectKeys.map((key) => ({Key: key}))
      }
    };
    return new Promise((resolve, reject) => {
      this.s3.deleteObjects(params, (err, res) => {
        if (err) return reject(err);
        return resolve(res);
      });
    });
  };

  /**
   * Runs a HEAD operation on a given bucket. Good for checking if it exists and
   * we have access to it
   *
   * @param {string} bucket Name of the bucket to check
   *
   * @return {Promise} Resolves with 'true' on successful access
   */
  async headS3Bucket(bucket) {
    const params = {
      Bucket: bucket
    };
    return new Promise((resolve, reject) => {
      this.s3.headBucket(params, (err, res) => {
        if (err) return reject(err);
        return resolve(!!res);
      });
    });
  }
}

module.exports = S3;
