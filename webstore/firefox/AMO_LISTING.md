# Firefox Add-ons (AMO) product page

What is entered on https://addons.mozilla.org/developers/addon/birdtab/edit,
field by field. Last updated 2026-10-15 (version 2.1.2, listing awaiting review).

Name, summary and description per language live in `<lang>.txt` next to this
file. This note covers everything else on the product page.

## Languages

AMO locales used: en-us (default), de, es-es, fr, ja, pl, pt-br, pt-pt, ru, zh-cn, zh-tw.

| Repo file | AMO locale |
| --- | --- |
| en.txt | en-us |
| de.txt | de |
| es.txt | es-es |
| fr.txt | fr |
| ja.txt | ja |
| pl.txt | pl |
| pt_BR.txt | pt-br |
| pt_PT.txt | pt-pt |
| ru.txt | ru |
| zh_CN.txt | zh-cn |
| zh_TW.txt | zh-tw |
| ar.txt | not used: AMO has no Arabic locale |

Users in a locale without a translation (es-mx, es-ar, ...)
see the English listing.

## Describe Add-on

| Field | Value |
| --- | --- |
| Name, Summary, Description | from `<lang>.txt` (all 11 AMO locales) |
| Add-on URL (slug) | `birdtab` |
| Experimental | no |
| Requires payment | no |
| Categories | Appearance; Photos, Music & Videos; Tabs |
| Support email | support@birdtab.app (en-us; other locales fall back to it) |
| Support website | https://birdtab.app (en-us); https://birdtab.app/<lang> for de, es-es (/es), fr, ja, pl, pt-br, ru, zh-cn (/zh), pt-pt (/pt-pt) and zh-tw (/zh-tw), both from 2.3.0 |

## Images

- Icon: the BirdTab icon from the manifest (unchanged).
- Screenshots: one set for all languages. AMO does not allow per-language
  images, only per-language captions.
  - Files: `extension/screenshots/firefox/amo/feature-image-1..5.jpg`
    (1280x800, English). Regenerated on 2026-10-18 for 2.2.0: slide 3 shows
    favorites and slide 5 Your Birds. Upload them with 2.2.0 to replace the earlier set.
  - Source design: `birdtab-marketing/pencil-documents/birdtab-marketing-edge.pen`,
    frames "Firefox · <Language>" (copies of the Edge frames with a Firefox
    eyebrow and no top-right shortcut, which Firefox doesn't have). How to
    update and re-export: `birdtab-marketing/pencil-documents/store-screenshots/README.md`.
  - Exports for every language: `birdtab-marketing/firefox/light-1280x800-png/<Language>/`
    and `.../light-1280x800/<Language>/` (JPG). Only English is used on AMO.
    Dark variants and promo tiles were not made for Firefox: AMO has no slot
    for them.
  - The previous five purple screenshots (ids 426755-426759) were removed.

### Screenshot captions

Taken from each frame's subline, so they match the image text.

| # | Image | en-us |
| --- | --- | --- |
| 1 | New bird in every tab | See a stunning new bird photo every time you open a tab. |
| 2 | Birds from around the world | Discover species from every continent with stunning high-resolution photography. |
| 3 | Bird calls and nature sounds | Hear real bird calls and ambient nature audio as you browse. |
| 4 | Search, shortcuts, clock, timer | Stay focused with search, shortcuts, clock, and timer in one tab. |
| 5 | Bird quiz | Challenge yourself with fun quizzes and discover new species daily. |

**de**
1. Sieh jedes Mal ein beeindruckendes neues Vogelfoto, wenn du einen Tab öffnest.
2. Entdecke Arten von allen Kontinenten mit beeindruckender hochauflösender Fotografie.
3. Höre beim Surfen echte Vogelrufe und stimmungsvolle Naturgeräusche.
4. Bleib fokussiert mit Suche, Kurzbefehlen, Uhr und Timer in einem Tab.
5. Fordere dich mit unterhaltsamen Quizzen heraus und entdecke täglich neue Arten.

**es-es**
1. Ve una foto espectacular de un ave nueva cada vez que abras una pestaña.
2. Descubre especies de todos los continentes con impresionantes fotografías en alta resolución.
3. Oye cantos reales y audio ambiental de la naturaleza mientras navegas.
4. Mantente enfocado con búsqueda, accesos directos, reloj y temporizador en una sola pestaña.
5. Ponte a prueba con quizzes divertidos y descubre nuevas especies cada día.

**fr**
1. Admirez une nouvelle photo d'oiseau spectaculaire chaque fois que vous ouvrez un onglet.
2. Découvrez des espèces de tous les continents grâce à de superbes photos haute résolution.
3. Écoutez de vrais chants d'oiseaux et l'ambiance de la nature pendant votre navigation.
4. Restez concentré avec la recherche, les raccourcis, l'horloge et le minuteur dans un seul onglet.
5. Relevez le défi avec des quiz amusants et découvrez de nouvelles espèces chaque jour.

**ja**
1. タブを開くたびに、魅力的な新しい鳥の写真が表示されます。
2. 美しい高解像度の写真で、すべての大陸に暮らす種を見つけよう。
3. ブラウジングしながら、本物の鳥の声や自然の環境音を楽しめます。
4. 検索、ショートカット、時計、タイマーを1つのタブにまとめて集中できます。
5. 楽しいクイズに挑戦して、毎日新しい種を発見しましょう。

**pl**
1. Zobacz zachwycające zdjęcie nowego ptaka za każdym razem, gdy otwierasz kartę.
2. Poznawaj gatunki ze wszystkich kontynentów dzięki zachwycającym fotografiom w wysokiej rozdzielczości.
3. Słuchaj autentycznych ptasich śpiewów i odgłosów natury podczas przeglądania.
4. Skup się dzięki wyszukiwaniu, skrótom, zegarowi i timerowi w jednej karcie.
5. Rzuć sobie wyzwanie w ciekawych quizach i codziennie odkrywaj nowe gatunki.

**pt-br**
1. Veja uma foto impressionante de um novo pássaro toda vez que abrir uma aba.
2. Descubra espécies de todos os continentes com fotografias impressionantes em alta resolução.
3. Ouça cantos reais de pássaros e áudio ambiente da natureza enquanto navega.
4. Mantenha o foco com pesquisa, atalhos, relógio e timer em uma única aba.
5. Desafie-se com quizzes divertidos e descubra novas espécies todos os dias.

**pt-pt**
1. Veja uma fotografia impressionante de uma nova ave sempre que abrir um separador.
2. Descubra espécies de todos os continentes em fotografias impressionantes de alta resolução.
3. Ouça cantos reais de aves e sons ambientes da natureza enquanto navega.
4. Mantenha a concentração com pesquisa, atalhos, relógio e temporizador num único separador.
5. Desafie-se com quizzes divertidos e descubra novas espécies todos os dias.

**ru**
1. Видьте новое потрясающее фото птицы каждый раз, когда открываете вкладку.
2. Открывайте виды со всех континентов благодаря потрясающим фотографиям в высоком разрешении.
3. Слушайте настоящие птичьи голоса и природную атмосферу во время просмотра.
4. Сохраняйте фокус с поиском, ярлыками, часами и таймером в одной вкладке.
5. Бросьте себе вызов с увлекательными викторинами и каждый день открывайте новые виды.

**zh-cn**
1. 每次打开标签页，都能看到一张惊艳的全新鸟类照片。
2. 通过惊艳的高分辨率摄影，发现来自各大洲的鸟类物种。
3. 浏览网页时聆听真实的鸟鸣和环境自然音。
4. 在一个标签页中专注使用搜索、快捷方式、时钟和计时器。
5. 通过有趣的问答挑战自己，每天发现新物种。

**zh-tw**
1. 每次開啟分頁，都能看到一張驚豔的全新鳥類照片。
2. 透過驚豔的高解析度攝影，認識來自各大洲的鳥種。
3. 瀏覽網頁時聆聽真實的鳥鳴與大自然環境音。
4. 在同一個分頁中專心使用搜尋、捷徑、時鐘和計時器。
5. 用有趣的測驗挑戰自己，每天認識新的鳥種。

## Additional Details

| Field | Value |
| --- | --- |
| Tags | search (AMO's fixed list has nothing about birds or wallpapers) |
| Contributions URL | none |
| Default locale | English (US) |
| Homepage en-us | https://birdtab.app |
| Homepage de / es-es / fr / ja / pl / pt-br / ru / zh-cn | https://birdtab.app/de, /es, /fr, /ja, /pl, /pt-br, /ru, /zh |

## Technical Details

Developer Comments, all 11 locales (en-us below; the others say the same):

> Questions, bug reports or a bird you'd like to see? Email support@birdtab.app or write to us at https://birdtab.app/contact.
>
> BirdTab is also available for Chrome and Edge. See what's new in each version: https://birdtab.app/changelog

## Manage Authors & License

Privacy policy: set (English, 812 characters).

## Search notes (from addons-server source, `search/filters.py`)

- Relevance comes only from name (strongest), summary (x3) and description
  (x2). Tags, slug, categories and developer comments are not searched.
- Translated name/summary/description are searched for de, es, fr, ja,
  pt-br, ru and zh-cn. Polish has no analyzer, so the pl text helps readers
  but not search.
- Score is multiplied by average daily users, and by 4 for approved,
  non-experimental listings. Keep "experimental" unchecked.
- Contributions URL accepts only donation platforms (PayPal, Patreon, Ko-fi,
  GitHub Sponsors, ...); left empty until BirdTab has one.

## Not on this page

Release notes and notes to reviewer (see `en.txt`) go on the version page
(Manage Status & Versions), not the product page.
