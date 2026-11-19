# Указатель сохранённых версий ShoppingApp

Для текущей разработки начинать со страницы [«С чего начать работу»](START_HERE.md). Ниже зафиксированы последние коммиты вспомогательных веток на 19 ноября 2026. Текущее наличие имён веток и архивных меток можно проверить в GitHub. Ссылки по коммитам используют точные версии файлов.

| Имя ветки на дату сверки | Версия | Содержимое |
|---|---|---|
| `feature/cloud-schema-draft` | [`f9f8bb6`](https://github.com/MusicMeasurer/shopping-app/tree/f9f8bb64ed56f92190ea96fd438eba86a2284e3b) | Базовая облачная схема и проверки прав. Эту ветку по имени используют проверки базы из main. |
| `feature/e1-release-gate` | [`8114602`](https://github.com/MusicMeasurer/shopping-app/tree/8114602648c3e0e08867ac4effab54c116459efe) | Ранний сценарий проверки перед выкладкой. |
| `feature/e2-function-acl-gate` | [`41bda31`](https://github.com/MusicMeasurer/shopping-app/tree/41bda3128c58e3c7aed01c59ea3b6d33f166522c) | Проверки прав на вызов функций БД. |
| `feature/e3-cloud-auth` | [`b11b2a6`](https://github.com/MusicMeasurer/shopping-app/tree/b11b2a6605c3337d7b975d9f7d30cb33608c4620) | Исходный прототип Siri, облачный вход и матрица E3. |
| `feature/e3-e4-integration` | [`9682496`](https://github.com/MusicMeasurer/shopping-app/tree/96824967e9d8b185a1ae712fcd7acfe8054872d8) | Первая попытка интеграции E3 и E4. |
| `feature/e4-accessibility-archive-fixes` | [`e8d05da`](https://github.com/MusicMeasurer/shopping-app/tree/e8d05da9fd80a3a37e675ebcdad9bd8580b7bdd7) | Исправления доступности, свайпов и защиты архива E4. |
| `feature/e4-compact-navigation` | [`5b00fac`](https://github.com/MusicMeasurer/shopping-app/tree/5b00faceeba7785b4e84dfb3c0a4ec80aa3e47e2) | Карточки списков и компактная навигация. |
| `feature/e4-functional-acceptance` | [`9a656d9`](https://github.com/MusicMeasurer/shopping-app/tree/9a656d9cb622480944621b94644f06a174e854b0) | Регрессионные тесты локального E4. |
| `feature/e4-lists-archive` | [`f772107`](https://github.com/MusicMeasurer/shopping-app/tree/f772107d3377d2ca1d195cb49b7d1d217fd712ba) | Локальные списки и архив, ранний чек-лист приёмки E4. |
| `feature/e4-swipe-panel-actions` | [`729f086`](https://github.com/MusicMeasurer/shopping-app/tree/729f086518c1a1bf8dca18384dd10f78b1248615) | Свайпы и быстрые действия со списками. |
| `feature/e4-ui-order-fixes` | [`5282779`](https://github.com/MusicMeasurer/shopping-app/tree/5282779f2f7c7f92020ffa5b194417134c51d5d4) | Компактные действия и сохранение порядка. |
| `feature/invitations-security-draft` | [`8f80bf5`](https://github.com/MusicMeasurer/shopping-app/tree/8f80bf52ab35150fcebb48cbff8f594e3743ef79) | Черновики семейных приглашений и передачи владения для E8. Содержит материалы, отсутствующие в текущей рабочей ветке и main. |
| `feature/local-profiles-foundation` | [`ae3e6e9`](https://github.com/MusicMeasurer/shopping-app/tree/ae3e6e954c9eef02740ee6350bd7626bd71ea200) | Промежуточная основа локальных профилей. |
| `release/interim-clean` | [`bd35ac8`](https://github.com/MusicMeasurer/shopping-app/tree/bd35ac834354f15523ddc20d6d15734f29a6f187) | Промежуточная чистовая версия. Коммит входит в main. |
| `snapshot/e4-local-integration-ci-passed-2026-11-11` | [`b378025`](https://github.com/MusicMeasurer/shopping-app/tree/b3780253dec8cd5478848edf125da01a43e12aa8) | Контрольная точка локальной интеграции. Коммит входит в main. |
| `snapshot/e4-ui-v1.0` | [`a3d42af`](https://github.com/MusicMeasurer/shopping-app/tree/a3d42af988da09f084d5888107272a7343c90752) | Ранее принятый интерфейс E4. Илья разрешил убрать имя ветки 19 ноября 2026. |
| `test/connector-write-access-20261030` | [`8891c97`](https://github.com/MusicMeasurer/shopping-app/tree/8891c97172a925c08c87b75ae5f2fec2a6093059) | Разовая проверка права записи, файл connector-write-test.txt. |

Перед удалением имени ветки с отдельной историей проверь метку, указывающую на её последний коммит. Для ветки с открытой заявкой на слияние зафиксируй её номер и исход, для используемой автоматикой ветки проверь замену зависимости. Архивная закладка должна открывать точную версию. Git-метка сохраняет исходники и историю Git.
