const fileExtensions = '**/*.{ts,tsx,js,json,css,md,sol}';

module.exports = {
    trailingComma: "es5",
  tabWidth: 4,
  useTabs: false,
  semi: true,
  singleQuote: false,
  overrides: [
    {
      files: fileExtensions,
      options: {}
    }
  ]
};
