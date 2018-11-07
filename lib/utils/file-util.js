'use strict';

const fs = require('fs');
const path = require('path');

const {Transform} = require('stream');

/**
 * Files extension names that are explicitly not transformed ever
 */
const TRANSFORM_BLACKLIST = [
  'git'
];

/**
 * Pseudo-Static class asynchronously wraps useful file system functions
 */
class FileUtil {
  /**
   * Simplified async wrapper for the fs.readdir method
   *
   * @param {string} dir Directory to read
   * @param {boolean} withFileTypes If file types should be provided
   *
   * @return {Promise} Resolves with either an array of strings, or fs.Dirent objects
   */
  static async readdir(dir, withFileTypes = false) {
    return new Promise((resolve, reject) => {
      fs.readdir(dir, {withFileTypes}, async (err, files) => {
        if (err) return reject(err);

        // If fs.Dirent is available, or we aren't getting filetypes, then we are done
        if (!withFileTypes || fs.Dirent) {
          return resolve(files);
        }

        // NODE <v10.10.0 SUPPORT
        // Otherwise we need to get stats on all the files, and apply the proper `name` property
        const statPromises = files.map((file) => {
          // Apply the full directory to the file so we can get the stats
          const fullFile = path.join(dir, file);
          return new Promise((statResolve, statReject) => {
            fs.stat(fullFile, (statErr, stat) => {
              if (statErr) return statReject(statErr);
              // Apply the originally retrieved file name to the stat to emulate fs.Dirent functionality
              stat.name = file;
              return statResolve(stat);
            });
          });
        });
        const stats = await Promise.all(statPromises);
        return resolve(stats);
      });
    });
  }

  /**
   * Simplified async wrapper for the fs.readFile method
   *
   * @param {string} filename Path of the file to read
   *
   * @return {Promise} Resolves with a buffer object representing file data
   */
  static async readFile(filename) {
    return new Promise((resolve, reject) => {
      fs.readFile(filename, (err, data) => {
        if (err) return reject(err);
        return resolve(data);
      });
    });
  }

  /**
   * Retrieves all file paths within a given directory
   *
   * @param {string} basePath Name of the directory to use
   *
   * @return {Promise} Resolves will an array of directory file paths
   */
  static async getDirRecursive(basePath) {
    // Get an array of "dirent" objects for the root directory
    let files = await this.readdir(basePath, true);

    /**
     * Internal helper function checks if any of the dirent elements in a given
     * array are directories
     *
     * @param {fs.Dirent[]} dirents Array of dirents taken from this.readdir
     *
     * @return {boolean} If the provided array contains any directories
     */
    const containsDir = (dirents) => {
      return dirents.some((dirent) => {
        return dirent.isDirectory();
      });
    };

    // Translate all directories into the containing files
    while (containsDir(files)) {
      for (let i=0; i<files.length; i++) {
        const file = files[i];
        if (file.isDirectory()) {
          let subFiles = await FileUtil.readdir(path.join(basePath, file.name), true);
          subFiles = subFiles.map((subFile) => {
            // Add the directory of the subFile to each file we found
            subFile.name = path.join(file.name, subFile.name);
            return subFile;
          });

          // Remove the old directory and add the directory files
          files.splice(i--, 1);
          files = files.concat(subFiles);
        }
      }
    }

    // Convert all dirent objects to full file paths and return
    return files.map((fileData) => {
      return path.join(basePath, fileData.name);
    });
  }

  /**
   * Synchronously retrieves all file paths within a given directory
   *
   * @param {string} basePath Name of the directory to use
   *
   * @return {string[]}  An array of directory file paths
   */
  static getDirRecursiveSync(basePath) {
    // Get an array of "dirent" objects for the root directory
    let files = fs.readdirSync(basePath, {withFileTypes: true});

    /**
     * Internal helper function checks if any of the dirent elements in a given
     * array are directories
     *
     * @param {fs.Dirent[]} dirents Array of dirents taken from this.readdir
     *
     * @return {boolean} If the provided array contains any directories
     */
    const containsDir = (dirents) => {
      return dirents.some((dirent) => {
        return dirent.isDirectory();
      });
    };

    // Translate all directories into the containing files
    while (containsDir(files)) {
      for (let i=0; i<files.length; i++) {
        const file = files[i];
        if (file.isDirectory()) {
          let subFiles = fs.readdirSync(path.join(basePath, file.name), {withFileTypes: true});
          subFiles = subFiles.map((subFile) => {
            // Add the directory of the subFile to each file we found
            subFile.name = path.join(file.name, subFile.name);
            return subFile;
          });

          // Remove the old directory and add the directory files
          files.splice(i--, 1);
          files = files.concat(subFiles);
        }
      }
    }

    // Convert all dirent objects to full file paths and return
    return files.map((fileData) => {
      return path.join(basePath, fileData.name);
    });
  }

  /**
   * Will copy a file from one location to another, using provided "transform"
   * and "flush" functions.
   *
   * Notes:
   * - Only files with extensions in the `text-extensions.js` file will be subjected
   *   to the transform and flush functions
   * - If using both the transform and flush functions, use classic function declarations
   *   (non-arrow functions) for access to a shared `this`.
   *   - Alternatively, these function can be manually bound to a common object for
   *     greater control
   *
   * Documentation on the use of these transformation functions can be found here:
   * https://nodejs.org/api/stream.html#stream_implementing_a_transform_stream
   *
   * @param {string} source File path of the source file
   * @param {string} dest File path of the destination file
   * @param {function(Buffer, string, Function)} transform Function to use for transformation
   * @param {function(Function)} flush Function to use at the very end of transformation
   */
  static async transformCopy(source, dest, transform, flush) {
    let TEXT_EXTENSIONS;
    try {
      TEXT_EXTENSIONS = require('./text-extensions.json');
    } catch (e) {
      console.warn('No text-extensions.json found, aborting transform');
      throw e;
    }

    return new Promise(async (resolve, reject) => {
      // Make sure the directory exists
      await FileUtil.makeDir(path.dirname(dest));
      if (TRANSFORM_BLACKLIST.includes(FileUtil.getExtname(source))) {
        // This file is on the blacklist
        console.group();
        console.log(`${source} [Skipped Copy]`);
        console.groupEnd();
        resolve(null);
        return;
      };

      if (!TEXT_EXTENSIONS.includes(FileUtil.getExtname(source))) {
        // If the source is not text, just do a regular fs.copy
        console.group();
        console.log(`${source} [Skipped Transform]`);
        console.groupEnd();

        fs.copyFile(source, dest, (err, res) => {
          if (err) return reject(err);
          resolve(res);
        });
        return;
      }

      // Log the destination
      console.log(dest);

      const trans = new Transform({transform, flush});

      const read = fs.createReadStream(source);
      const write = fs.createWriteStream(dest);

      read.pipe(trans);
      trans.pipe(write);

      write.on('error', (err) => {
        reject(err);
      });

      write.on('close', () => {
        resolve();
      });
    });
  }

  /**
   * Async wrapper for fs.mkdir that is recursive by default. If the file already
   * exists than that will be counted as success
   *
   * @param {string} dirPath Path of the directory to create
   *
   * @return {Promise} Resolves on success
   */
  static async makeDir(dirPath) {
    const opts = {
      recursive: true
    };
    return new Promise(async (resolve, reject) => {
      fs.mkdir(dirPath, opts, async (err) => {
        if (err) {
          // Check for the specific "File already exists" error
          if (err.code === 'EEXIST') return resolve();

          // The recursive nature of fs.mkdir doesn't go far enough. If we get a
          // "no such file or directory" error then make the parent directory and try again,
          // this will naturally recurse as much as necessary
          if (err.code === 'ENOENT') {
            await FileUtil.makeDir(path.dirname(dirPath));
            await FileUtil.makeDir(dirPath);
            return resolve();
          }

          return reject(err);
        }
        resolve();
      });
    });
  }

  /**
   * Async wrapper for fs.writeFile
   *
   * @param {string} filePath Path to write the file to
   * @param {string} content Content to write to the file
   *
   * @return {Promise} Resolves on success
   */
  static async writeFile(filePath, content) {
    return new Promise((resolve, reject) => {
      fs.writeFile(filePath, content, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  /**
   * Writes a file to a given path, creating directories as needed
   *
   * @param {string} filePath Path to write the file to
   * @param {string} content Content to write to the file
   *
   * @return {Promise} Resolves on success
   */
  static async makeFile(filePath, content) {
    return new Promise(async (resolve, reject) => {
      try {
        // Make the directory
        await FileUtil.makeDir(path.dirname(filePath));

        // Then write the file
        await FileUtil.writeFile(filePath, content);
      } catch (e) {
        return reject(e);
      }

      resolve();
    });
  }

  /**
   * Gets the extension of a file, casting a wider net than the native path.extname
   * function. If path.extname fails to find an extension, the full base name will
   * be returned (minus any preceding dots);
   *
   * @param {string} filePath File path to find the extension of
   *
   * @return {string} File extension name
   */
  static getExtname(filePath) {
    let ext = path.extname(filePath);

    if (!ext) {
      // If there is no extension, return the full file name
      ext = path.basename(filePath);
    }

    // Remove any preceding dots
    ext = ext.match(/\.?(.+)/)[1];
    return ext;
  }

  /**
   * Takes a given full path and removes the base path part provided. In case of
   * a mismatch, nothing is done
   *
   * @param {string} basepath Base path to remove from the full path
   * @param {string} fullPath Full path to remove the base path from
   *
   * @return {string} The altered full path
   */
  static removeBasepath(basepath, fullPath) {
    // Normalize and then split into arrays
    basepath = path.normalize(basepath);
    fullPath = path.normalize(fullPath);

    const baseArr = basepath.split(path.sep);
    const fullArr = fullPath.split(path.sep);

    for (let i=0; i<baseArr.length;) {
      if (baseArr[i] !== fullArr[i]) {
        // A mismatch was found, return the original full path
        return fullPath;
      }

      baseArr.shift();
      fullArr.shift();
    }

    // Remake the full path
    fullPath = fullArr.join(path.sep);

    return fullPath;
  }

  /**
   * Extremely simple wrapper of fs.createReadStream
   *
   * @param {string} filePath File path to create the read stream for
   * @param {object} opts Options for generating the read stream
   *
   * @return {ReadableStream} Read Stream
   */
  static createReadStream(filePath, opts) {
    return fs.createReadStream(filePath, opts);
  }
}

module.exports = FileUtil;
