#!/usr/bin/env node

// Handle all unhandled rejections
process.on('unhandledRejection', (err) => {
  console.error('\n------------------ UNHANDLED REJECTION ------------------');
  console.group();
  console.error(err);
  console.groupEnd();
  process.exit(1);
});

const Args = require('../lib/utils/args.js');

(async () => {
  // Process and validate arguments
  const args = new Args(process.argv);

  try {
    await args.validate();
  } catch (e) {
    // There was a validation error
    console.error('\nINVALID ARGUMENTS:');
    console.group();
    console.error(e.message);
    console.groupEnd();
    process.exit(1);
  }

  // Initialize the action
  const action = require(`../lib/actions/${args.args[0]}.js`);

  // Check for help
  if (args.opts.h || args.opts.help) {
    console.log(action.help);
    return;
  }

  // Run the action
  try {
    await action.exec(args);
  } catch (e) {
    // Log errors and exit
    console.error('ERROR RUNNING SCRIPT:');
    console.group();
    console.error(e);
    console.groupEnd();
    console.error('Ending Process');
    process.exit(1);
  }
})();
