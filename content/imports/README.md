# Импорт обычных картинок

Каждая картинка помещается в отдельную папку с постоянным номером и ASCII ID:

```text
content/imports/
  defaults.json
  011-fox/
    source.png
    import.json
```

Поддерживаются PNG, JPEG и WebP, EXIF orientation, прозрачный и белый фон,
квадратные и прямоугольные изображения. Исходники используются только при
разработке и никогда не копируются в runtime или Yandex ZIP.

Общие параметры уже заданы в `defaults.json`: 20×20, семь цветов, padding 1,
удаление белого фона с краёв и слияние близких цветов. Поэтому обычный
`import.json` содержит только metadata:

```json
{
  "id": "fox",
  "order": 11,
  "title": { "ru": "Лисёнок", "en": "Little Fox" },
  "category": "animals",
  "tags": {
    "ru": ["лиса", "лисёнок", "животное"],
    "en": ["fox", "animal", "cute"]
  }
}
```

Папка обязана называться `011-fox`, то есть совпадать с `order + id`. ID после
публикации не меняется. Допустимы только lowercase ASCII-буквы, цифры и дефисы.

Параметры конкретной картинки переопределяются частично:

```json
{
  "id": "snowman",
  "order": 12,
  "title": { "ru": "Снеговик", "en": "Snowman" },
  "category": "nature",
  "tags": { "ru": ["снеговик"], "en": ["snowman"] },
  "grid": {
    "columns": 24,
    "rows": 24,
    "colorCount": 8,
    "removeWhiteBackground": false,
    "mergeColorDistance": 24
  }
}
```

`removeWhiteBackground: true` удаляет только белую область, связанную с краем;
замкнутые белые детали объекта остаются. Для белого объекта на белом фоне лучше
использовать прозрачный PNG либо `removeWhiteBackground: false`.

Запуск полного цикла:

```bash
npm run import:images
npm run qa:levels
npm run validate:levels
npm run build
```

Неизменённые уровни пропускаются до запуска Sharp. SHA-256 включает bytes
`source.*`, `import.json`, глобальный `defaults.json` и версию алгоритма; cache
лежит в `.cache/import-images/cache.json` и не входит в Git или Yandex ZIP.
Если исходник существующего уровня изменён, импорт без `--force` сообщает отказ.
После визуальной проверки или для принудительной полной обработки:

```bash
npm run import:images -- --force
```

При reimport сохраняются вручную исправленные title, tags, category и order.
Geometry, palette и difficulty пересчитываются; при реальном изменении artwork
или palette автоматически повышается `contentVersion`, чтобы старый bitset-save
не раскрашивал другие пиксели.

В конце команда печатает imported/skipped/failed/warnings. Warnings не блокируют
уровень, но указывают на чрезмерно пустую/заполненную сетку, доминирующий цвет,
изолированные пиксели, слишком близкие цвета или чрезмерно простую картинку.
