module.exports = {
  'extends': 'google',
  'parserOptions': {
    'ecmaVersion': 2018
  },
  rules:{
    'linebreak-style': 0,
    'quotes': ['error', 'single', { 'allowTemplateLiterals': true }],
    'comma-dangle': ['error', 'never'],
    'require-jsdoc': 0,
    'new-cap': 0,
    'camelCase': 0,
    'no-extend-native': 'off',
    'max-len': ['error', {
      'code': 120,
      'ignoreStrings': true,
      'ignoreTemplateLiterals': true
    }]
  }
};
