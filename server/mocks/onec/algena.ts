/**
 * Демо-товары для мока 1С: раздел «Сухие смеси и гидроизоляция» каталога algena.by (снят
 * 2026-10-14). Чтобы на стенде клиент видел свои товары, цены и картинки, а не «модель 101».
 * Картинки грузит браузер с публичного сайта algena.by — это витрина, не обмен с 1С.
 */
export interface DemoItem { name: string, price: number, image: string | null }

export const ALGENA_DRY_MIXES: DemoItem[] = [
  { name: "ilmax CemTop Express (25кг) быстросохнущая стяжка цементная", price: 18.2, image: null },
  { name: "Шпатлевка готовая SP21 4кг белая финишная SUPER-PUTZ РБ", price: 13.9, image: "https://algena.by/upload/resize_cache/iblock/917/3kap0lv016calhkvjvb9su4ae8v98b6e/350_350_1/shpatlevka-gotovaya-sp21-4kg-belaya-finishnaya-super-putz-rb.jpg" },
  { name: "Шпатлевка готовая SP21 1,5кг белая финишная SUPER-PUTZ РБ", price: 6.15, image: "https://algena.by/upload/resize_cache/iblock/468/u0dxm7iivgi6q35j3y29sk14dct62dd0/350_350_1/shpatlevka-gotovaya-sp21-1-5kg-belaya-finishnaya-super-putz-rb.jpg" },
  { name: "Экабуд для печей (5кг) Растворная смесь сухая кладочная", price: 10.2, image: "https://algena.by/upload/resize_cache/iblock/8b1/zwns8wfnjozcreq7r17hiz060hw145sf/350_350_1/ekabud-dlya-pechey-5kg-rastvornaya-smes-sukhaya-kladochnaya.png" },
  { name: "\"Тайфун Мастер\" ПЕЧНИК Кладочно-штукатурная жаростойкая смесь для печей и каминов меш. 5 кг", price: 10.1, image: null },
  { name: "Клей для стеклохолста и стеклотканевых обоев \"LUX Armfix\" ведро 9 кг", price: 60.5, image: "https://algena.by/upload/iblock/f98/3bxuwql677uyadzuktxtlhtlyzsazflb/kley-dlya-steklokholsta-i-steklotkanevykh-oboev-lux-armfix-vedro-9-kg.png" },
  { name: "Клей для стеклохолста и стеклотканевых обоев \"LUX Armfix\" ведро 16 кг", price: 96.5, image: "https://algena.by/upload/iblock/d9f/y3agbh889a1urxjbzalbfguva755jtcx/kley-dlya-steklokholsta-i-steklotkanevykh-oboev-lux-armfix-vedro-16-kg.png" },
  { name: "Клеевой раствор \"Люкс\" для гипсокартона меш. 5 кг", price: 6.9, image: "https://algena.by/upload/iblock/e27/08uanb3lltyd0y5fu7h762jcrfxnv66k/kleevoy-rastvor-lyuks-dlya-gipsokartona-mesh-5-kg.jpg" },
  { name: "Шпатлевка полимерная белая \"Люкс\" POLIMODERN внутр. меш. 20 кг", price: 31.4, image: null },
  { name: "ilmax ready coat start-finish выравнивающая (25кг) шпатлевка готовая белая", price: 60.0, image: "https://algena.by/upload/iblock/68e/i5b9quq9e8i3zijeg89yoepok3g7zuei/ilmax-ready-coat-start-finish-vyravnivayushchaya-25kg-shpatlevka-gotovaya-belaya.png" },
  { name: "ilmax ready coat start-finish выравнивающая (5кг) шпатлевка готовая белая", price: 15.4, image: "https://algena.by/upload/iblock/61d/f8na6chwr4mx4lc4okpkxd5jljq72px1/ilmax-ready-coat-vyravnivayushchaya-5kg-shpatlevka-gotovaya-belaya.jpg" },
  { name: "Шпатлевка полимерная \"LUX GO\", ведро 5 кг", price: 17.9, image: "https://algena.by/upload/iblock/3c7/9zumlqircvsgh028a85r6wbp5v7clo4z/shpatlevka-polimernaya-lux-go-vedro-5-kg.png" },
  { name: "ilmax гипс-монтаж (12кг) Монтажная смесь быстротвердеющая", price: 10.2, image: "https://algena.by/upload/resize_cache/iblock/7ca/l0xi77sguj4daqloof3cugatlmdnjvd9/350_350_1/ilmax-gips-montazh-12kg-montazhnaya-smes-bystrotverdeyushchaya.png" },
  { name: "\"Тайфун Мастер\" №35 РСС ремонтно гипсовая \"гипс строительный\" меш. 15 кг", price: 14.1, image: "https://algena.by/upload/iblock/6f3/jnwxmi791f4qder4jo36qu430vcl14wm/gips-stroitelnyy-tayfun-master-35-15-kg.jpg" },
  { name: "Композиция для заполнения швов Фуга крупнозернистая (5 кг), ультрабелый", price: 20.0, image: "https://algena.by/upload/resize_cache/iblock/7ab/mpcg3odcbq7wyfkvzvtyag8xu0a14u26/350_350_1/kompozitsiya-dlya-zapolneniya-shvov-fuga-krupnozernistaya-5-kg-ultrabelyy-.jpg" },
  { name: "\"Тайфун Мастер\" №35 РСС ремонтно гипсовая \"гипс строительный\" меш. 2 кг", price: 3.6, image: "https://algena.by/upload/iblock/a87/ff950s185krtb1ro9mm614432pp7shh2/gips-stroitelnyy-tayfun-master-35-2-kg.jpg" },
  { name: "Жидкое стекло (1,3кг ) FARBITEX", price: 11.1, image: "https://algena.by/upload/iblock/d7c/4vyvly5goqu19yoj1c8l4fjredglg4mo/zhidkoe-steklo-1-3kg-farbitex.png" },
  { name: "Ceresit/СМ 115/ Растворная сухая облицовачная смесь (для мрамора и мозаики) белая 25кг", price: 36.9, image: "https://algena.by/upload/iblock/3a4/aeo4w49sjioy7u5asmxb9s73cvgl31dr/kley-dlya-mramora-i-mozaiki-belyy-ceresit-cm-115-25-kg.png" },
  { name: "Шпатлевка-замазка для заделки глубоких выбоин и трещин Plastix / 1,4 кг", price: 18.1, image: "https://algena.by/upload/iblock/866/3jnhp6j9podo2dqtihorhfxptee3hmm5/shpatlevka-zamazka-dlya-zadelki-glubokikh-vyboin-i-treshchin-plastix-1-4-kg.png" },
  { name: "ilmax 6530 (25кг) под окраску защ.-отдел. штукатурка .для наруж. и внутр. работ (1.0мм)", price: 19.2, image: "https://algena.by/upload/resize_cache/iblock/452/zotrwvpac9d9itbne06j7p0zw2uz00rs/350_350_1/ilmax-6530-25kg-pod-okrasku-zashch-otdel-shtukaturka-dlya-naruzh-i-vnutr-rabot-1-0mm.png" },
]
