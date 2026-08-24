import neostandard from 'neostandard'
import markdown from '@eslint/markdown'
import vue from 'eslint-plugin-vue'

export default [
  ...neostandard(),
  {
    files: ['**/*.md'],
    plugins: {
      markdown,
    },
    processor: 'markdown/markdown',
  },
  ...vue.configs['flat/recommended']
]
