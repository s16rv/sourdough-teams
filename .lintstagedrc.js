const prettierConfig = require('./prettier.config');

module.exports = {
  [prettierConfig.fileExtensions]: 'prettier --write .'
};
