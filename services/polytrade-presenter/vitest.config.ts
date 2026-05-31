import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['**/*.{spec,test}.ts'],
          exclude: ['**/node_modules/**'],
        },
      },
    ],
  },
})
