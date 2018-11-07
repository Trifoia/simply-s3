'use strict';

const path = require('path');

const S3 = require('../utils/s3.js');
const Input = require('../utils/input.js');
const FileUtil = require('../utils/file-util.js');

// Get configuration
const config = require('../../config/s3-config.js');

const getEnvars = async (args) => {
// Get envars and check to see if we are missing anything
  const envars = {
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_DEFAULT_REGION: args.opts.region || process.env.AWS_DEFAULT_REGION
  };
  const envarKeys = Object.keys(envars);
  let input;
  for (let i=0; i<envarKeys.length; i++) {
    const key = envarKeys[i];
    const val = envars[key];

    // No need to do anything if there is already a value
    if (val) continue;

    // Error if the value is undefined and the -nocli flag is being used
    if (args.opts.n || args.opts.nocli) {
      throw new Error(`Missing "${key}" envar in no cli mode`);
    }

    // Otherwise open a readline interface to interact with the user
    if (!input) {
      console.log('Missing variables detected...');
      input = new Input({
        input: process.stdin,
        output: process.stdout
      });
    }

    // Don't mute the region input
    let askString = `\nPlease provide a value for "${key}"`;
    let hide = false;
    if (key !== 'AWS_DEFAULT_REGION') {
      askString += ' (input will be hidden)';
      hide = true;
    }

    envars[key] = await input.ask(askString, hide);
  }
  if (input) {
    input.close();
    console.log('\nThank you. Continuing operation...');
  }
  return envars;
};

const help = `
Simply S3 Help
Action: upload

This action will upload the current directory to S3

Command Structure:
  $ simplys3 upload <bucket_path>

Arguments:
  - bucket_path:
    The bucket to upload data, plus the path within the bucket data should be
    stored in. Note that paths must be "unix" style
      Example: 
        $ simplys3 upload mybucket/my/sub/directory
        Will upload data to the "my/sub/directory" path within "mybucket"

Options:
  --region {string}   Region to upload data to
                        Default: Defined by envar AWS_DEFAULT_REGION
  --max {string}      Maximum upload size in Bytes. Any files greater than this
                      size will be uploaded using the "multi-part" paradigm
                        Default: ${config.MAX_BYTES} Bytes
  --source {string}   Directory to upload to S3
                        Default: . (the current directory)
  -n, --nocli {flag}  Flag will cause the process to fail if envars are not
                      defined
`;

const exec = async (args) => {
  console.log('Beginning upload action...');
  console.group();

  // Get all required variables
  let sourceDir = process.cwd();
  if (args.opts.source) {
    sourceDir = path.join(sourceDir, args.opts.source);
  }

  // Separate the bucket from the path
  let bucket = args.args[1];
  const pathIndex = bucket.indexOf('/');
  let bucketPath = null;
  if (pathIndex >= 0) {
    bucketPath = bucket.slice(pathIndex);
    bucket = bucket.slice(0, pathIndex);
  }
  const envars = await getEnvars(args);

  console.log(`\nConfiguration complete`);
  console.group();
  console.log(`Source Directory: ${sourceDir}`);
  console.log(`Target Region: ${envars.AWS_DEFAULT_REGION}`);
  console.log(`Target Bucket: ${bucket}`);
  console.groupEnd();
  if (bucketPath) console.log(`Target Path: ${bucketPath}`);

  console.log('\nVerifying Bucket State...');
  const s3 = new S3({
    accessKeyId: envars.AWS_ACCESS_KEY_ID,
    secretAccessKey: envars.AWS_SECRET_ACCESS_KEY,
    region: envars.AWS_DEFAULT_REGION
  });
  try {
    await s3.headS3Bucket(bucket);
  } catch (e) {
    throw new Error('Requested S3 Bucket cannot be found or accessed');
  }

  console.log('\nGathering Files...');
  const files = await FileUtil.getDirRecursive(sourceDir);
  const fileKeys = files.map((fileName) => {
    const key = FileUtil.removeBasepath(sourceDir, fileName);
    return path.join('.', (bucketPath || '/'), key);
  });
  const fileReadStreams = files.map((fileName) => FileUtil.createReadStream(fileName, {highWaterMark: 256 * 1024}));

  console.log('\Found Files:');
  console.group();
  const uploadPromises = [];
  for (let i=0; i<files.length; i++) {
    const fileName = files[i];
    const fileKey = fileKeys[i];
    const fileReadStream = fileReadStreams[i];
    console.log(fileName);

    // Get and log some stats
    const stats = await FileUtil.getStatsSync(fileName);
    console.group();
    console.log(`File Size: ${stats.size} Bytes`);
    console.log(`Expected Number of Chunks: ${Math.ceil(stats.size / config.MAX_BYTES)}`);
    console.log(`Expected Number of Batches: ${Math.ceil((stats.size / config.MAX_BYTES / config.MAX_CONCURRENT))}`);
    console.groupEnd();

    uploadPromises.push(s3.putS3Stream(fileReadStream, bucket, fileKey));
  }
  console.groupEnd();

  console.log('\nUploading Files...');
  console.group();
  await Promise.all(uploadPromises);
  console.groupEnd();
  console.log('\nFinished Uploading Files!');

  console.groupEnd();
  console.log('Upload complete!');
};

module.exports.exec = exec;
module.exports.help = help;
