'use strict';

/**
 * Configurations for the s3 helper class
 */
module.exports = {
  /**
   * The maximum number of bytes an uploaded chunk can be
   */
  MAX_BYTES: 18000000,

  /**
   * The maximum number of upload parts to run at once for each object
   */
  MAX_CONCURRENT: 10
};
