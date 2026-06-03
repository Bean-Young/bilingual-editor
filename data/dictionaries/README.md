# Public Dictionary Sources

## CC-CEDICT

`cedict_1_0_ts_utf-8_mdbg.txt.gz` is the MDBG distribution of CC-CEDICT.

- Source: https://www.mdbg.net/chinese/dictionary?page=cc-cedict
- License: Creative Commons Attribution-ShareAlike 4.0 International
- Project information: https://cc-cedict.org/wiki/

The frontend term subset in `src/translation/publicZhEnTerms.js` is generated from this file with:

```bash
node scripts/build-cedict-subset.mjs
```

## ECDICT

`ecdict.csv` is the English-Chinese dictionary database from ECDICT.

- Source: https://github.com/skywind3000/ECDICT
- License: MIT

The full CSV is intentionally ignored by git because it is large. Download it before regenerating the frontend subset:

```bash
curl -L https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv -o data/dictionaries/ecdict.csv
node scripts/build-ecdict-subset.mjs
```

The generated frontend subset is stored in `src/translation/publicEcdictTerms.js`.
