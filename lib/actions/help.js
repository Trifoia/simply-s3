'use strict';

const help = `
Simply S3 Help

Command Structure:
  $ simplys3 <action> <args> [options]

Arguments
- action:
  Will run a pre-defined action
  Valid options are: 'upload', 'help'

- args:
  Arguments that will be passed to given action function

Options:
  -h, --help {flag} Print help text for the given action

Environment Variables:
  The following environment variables are used to access S3. If these variables
  are not present, the CLI will ask you for their values

  - AWS_ACCESS_KEY_ID       Your AWS Access Key ID
  - AWS_SECRET_ACCESS_KEY   Your AWS Secret Access Key
  - AWS_DEFAULT_REGION      The region being accessed
`;

const exec = async () => {
  console.log(help);
};

module.exports.exec = exec;
module.exports.help = help;
