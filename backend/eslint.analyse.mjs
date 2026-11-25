// @ts-check
// Seuils de lisibilité de cadence (L183, D-31 ; docs/analyse.md et docs/qualite.md de cadence) joués par
// `cadence analyse` à la porte de chaque lot. L'existant qui les dépasse est figé dans .cadence/analyse/
// (cliquet : seules les violations nouvelles échouent) ; on ne relâche pas un seuil ici pour faire passer un lot.
// Sans règles typées ni prettier : la vérification des types est l'entrée tsc, et la porte reste sous la minute.
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'eslint.analyse.mjs', 'eslint.config.mjs'] },
  ...tseslint.configs.recommended,
  {
    plugins: { sonarjs },
    rules: {
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
      'max-depth': ['error', 4],
      'max-params': ['error', 5],
      complexity: ['error', 15],
      'sonarjs/cognitive-complexity': ['error', 15],
      // choix du projet, repris de eslint.config.mjs : any toléré dans le backend
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
