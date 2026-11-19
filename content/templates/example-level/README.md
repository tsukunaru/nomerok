# Example level

Это минимальный валидный пиксельный шаблон из 62 клеток. Он не сканируется production-сборкой, пока папка находится в `content/templates/`.

Чтобы создать уровень:

1. Скопируйте эту папку в `content/levels/<порядок>-<slug>/`.
2. Замените `id`, `order`, RU/EN title, category, tags и palette.
3. Замените клетки 1×1 в `artwork.svg`, сохранив их целочисленную сетку и центры номеров.
4. Выполните `npm run validate:levels`.

Полный контракт и ограничения описаны в `LEVEL_ASSET_SPEC.md`.
