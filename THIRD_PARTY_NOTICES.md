# Third-party notices

## Packaged code and runtimes

`THIRD_PARTY_LICENSES.txt` contains the generated production-package inventory and the license texts shipped for Zyra's JavaScript dependencies, Bun 1.3.9, and Node.js 22.22.0. The release check ties that file to both production lockfiles and rejects stale runtime versions.

Desktop packages also retain Electron's license and Chromium's generated license list beside the application. The self-contained Windows computer-use sidecar carries `DOTNET-LICENSE.txt` and `DOTNET-THIRD-PARTY-NOTICES.txt` beside its binaries.

## PostHog capture service

Zyra can send explicitly enabled, allowlisted product events to a user-configured [PostHog](https://posthog.com/) project through PostHog's documented capture API. Zyra does not bundle the PostHog SDK or enable its browser autocapture, session replay, heatmap, DOM capture, or remote feature-flag features. Use of a configured PostHog service remains subject to the service operator's terms and privacy settings.

## Product logos from SVGL

Zyra includes logo artwork published by the SVGL project:

- OpenAI: https://github.com/pheralb/svgl/blob/main/static/library/openai.svg
- Bun, Node.js, npm, pnpm, and Yarn: https://github.com/pheralb/svgl/tree/main/static/library
- Arc, Brave, Chrome, Chromium, Edge, Firefox, Opera, Safari, Vivaldi, and Zen Browser: https://github.com/pheralb/svgl/tree/main/static/library
- Project: https://github.com/pheralb/svgl
- OpenAI brand guidance: https://openai.com/brand/

The included names and logos are trademarks of their respective owners. Their appearance identifies a connection or detected browser profile and does not imply endorsement of Zyra.

SVGL is distributed under the MIT License:

> MIT License
>
> Copyright (c) 2022 Pablo Hdez
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

## Developer-tool logos from Simple Icons

Zyra includes Simple Icons artwork for Android Studio, CLion, GoLand, IntelliJ IDEA, JetBrains, PhpStorm, PyCharm, Rider, Sublime Text, VSCodium, WebStorm, and Zed. The Simple Icons collection is released under [CC0 1.0 Universal](https://github.com/simple-icons/simple-icons/blob/develop/LICENSE.md). Simple Icons also publishes an [icon licensing and trademark disclaimer](https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md).

Zyra also displays product marks for other detected editors and developer tools. All product names and logos remain the property of their respective owners. They are shown only to identify a detected application or runtime and do not imply sponsorship or endorsement of Zyra.

## Material Icon Theme file icons

Zyra bundles file-type artwork from [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme). The package and its MIT license are recorded in `THIRD_PARTY_LICENSES.txt`.

## Plugin catalog metadata and logos

The Plugins directory includes descriptive metadata and publisher logos from the pinned [OpenAI Plugins catalog](https://github.com/openai/plugins). The exact catalog revision is recorded in `desktop/src/shared/plugins/openai-directory.json`; logo source URLs are recorded in `desktop/src/renderer/src/assets/plugin-logos/sources.json`. These marks identify their respective packages and publishers and do not imply sponsorship or endorsement of Zyra. Their trademarks and applicable asset rights remain with their owners; Zyra does not assign them its Apache-2.0 source-code license.

Downloaded Plugin packages are separate from the bundled directory. Each release's own license and provenance require review before installation. Zyra-written directory summaries are marked separately from publisher descriptions.

## Kenney UI Audio voice cues

The `voice-ready.wav` and `voice-ended.wav` cues are adapted from `switch3.wav` and `switch4.wav` in [Kenney UI Audio](https://kenney.nl/assets/ui-audio). Kenney released the audio under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/). The CC0 text is included in `THIRD_PARTY_LICENSES.txt`.

## Bootstrap Icons incognito icon

Zyra includes the hat-and-glasses [Incognito icon from Bootstrap Icons](https://icons.getbootstrap.com/icons/incognito/). Bootstrap Icons is distributed under the [MIT License](https://github.com/twbs/icons/blob/main/LICENSE).

<!-- browser-surface-third-party:start -->
## Ghostery ad blocker

Zyra uses [Ghostery's embeddable ad blocker](https://github.com/ghostery/adblocker), including the Electron integration, to optionally apply EasyList/uBlock-compatible network, cosmetic, scriptlet, and annoyance rules inside Zyra Browser. Blocking is disabled by default. Ghostery Adblocker is copyright © 2017-present Ghostery GmbH and distributed under the [Mozilla Public License 2.0](https://www.mozilla.org/MPL/2.0/).

Filter data is fetched and cached at runtime from Ghostery's prebuilt subscriptions. Those lists retain their respective authorship and license terms; Zyra does not relicense them.

## CastLabs Electron for Content Security

Zyra uses [CastLabs Electron for Content Security](https://github.com/castlabs/electron-releases) as its Electron distribution so users can install Google Widevine through Chromium's component updater for protected media playback. CastLabs Electron is copyright © 2017-2025 castLabs GmbH and distributed under the MIT License.

Zyra does not bundle or redistribute the Widevine CDM. When protected-media support is available, the CDM is downloaded directly through Google's component service and remains subject to Google's terms. Production Windows and macOS packages require CastLabs EVS VMP signing.

## PhishTank phishing data

Zyra Browser downloads PhishTank's verified-online phishing feed in the background and converts it into a local hashed lookup index. Page addresses are checked locally and are not sent to PhishTank during navigation. PhishTank is operated by OpenDNS, LLC / Cisco Talos Intelligence Group. Its data is available without charge, including for commercial use, and is provided without a warranty of accuracy. See the [PhishTank developer information](https://phishtank.org/developer_info.php) and [terms of use](https://phishtank.org/terms.php).

## Bundled New Tab nature backgrounds

Zyra includes 45 separately licensed images sourced from Wikimedia Commons. The files were resized, converted to WebP, and stripped of metadata for the bundled background pack. The licenses below apply to the individual images, independently of Zyra's Apache-2.0 source-code license. Share-alike images remain available under the indicated Creative Commons license.

- [Woodland path through a conifer forest - geograph.org.uk - 5928776](https://commons.wikimedia.org/wiki/File:Woodland_path_through_a_conifer_forest_-_geograph.org.uk_-_5928776.jpg) — John P Reeves; [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0); resized to 1600×900, converted to webp, metadata removed.
- [Forest track in Leanachan Forest - geograph.org.uk - 5823312](https://commons.wikimedia.org/wiki/File:Forest_track_in_Leanachan_Forest_-_geograph.org.uk_-_5823312.jpg) — Graham Robson; [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0); resized to 1600×1067, converted to webp, metadata removed.
- [Woodland Path in Dunwich Forest - geograph.org.uk - 3744288](https://commons.wikimedia.org/wiki/File:Woodland_Path_in_Dunwich_Forest_-_geograph.org.uk_-_3744288.jpg) — Geographer; [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0); resized to 1600×1200, converted to webp, metadata removed.
- [Forest track on northern edge of Broxa Forest - geograph.org.uk - 4377779](https://commons.wikimedia.org/wiki/File:Forest_track_on_northern_edge_of_Broxa_Forest_-_geograph.org.uk_-_4377779.jpg) — Martin Dawes; [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0); resized to 1600×1200, converted to webp, metadata removed.
- [Forest track in Coire Ardrain - geograph.org.uk - 6082898](https://commons.wikimedia.org/wiki/File:Forest_track_in_Coire_Ardrain_-_geograph.org.uk_-_6082898.jpg) — Jim Barton; [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0); resized to 1600×1066, converted to webp, metadata removed.
- [Landscape Arnisee-region](https://commons.wikimedia.org/wiki/File:Landscape_Arnisee-region.JPG) — Simon Koopmann; [CC BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5); resized to 1600×1064, converted to webp, metadata removed.
- [Frosty Raftsundet landscape with Trolltindan in morning, 2012 October](https://commons.wikimedia.org/wiki/File:Frosty_Raftsundet_landscape_with_Trolltindan_in_morning,_2012_October.JPG) — Ximonic (Simo Räsänen); [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0); resized to 1600×1060, converted to webp, metadata removed.
- [Mountain and tundra landscape in Ivvavik National Park, YT](https://commons.wikimedia.org/wiki/File:Mountain_and_tundra_landscape_in_Ivvavik_National_Park,_YT.jpg) — Daniel Case; [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0); resized to 1600×986, converted to webp, metadata removed.
- [Castle Mountain](https://commons.wikimedia.org/wiki/File:Castle_Mountain.jpg) — Jakub Fryš; [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0); resized to 1600×1060, converted to webp, metadata removed.
- [Mountains in snow, Mountain lake, Chola Valley, Nepal, Himalayas](https://commons.wikimedia.org/wiki/File:Mountains_in_snow,_Mountain_lake,_Chola_Valley,_Nepal,_Himalayas.jpg) — Vyacheslav Argenberg; [CC BY 4.0](https://creativecommons.org/licenses/by/4.0); resized to 1600×1067, converted to webp, metadata removed.
- [Dyrhólaey, Suðurland, Islandia, 2014-08-17, DD 140](https://commons.wikimedia.org/wiki/File:Dyrh%C3%B3laey,_Su%C3%B0urland,_Islandia,_2014-08-17,_DD_140.jpg) — Diego Delso; [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0); resized to 1600×1067, converted to webp, metadata removed.
- [Komos site baie Crète](https://commons.wikimedia.org/wiki/File:Komos_site_baie_Cr%C3%A8te.jpg) — Jebulon; [CC0](http://creativecommons.org/publicdomain/zero/1.0/deed.en); resized to 1600×1025, converted to webp, metadata removed.
- [Peterborough (AU), Port Campbell National Park, Worm Bay -- 2019 -- 0863](https://commons.wikimedia.org/wiki/File:Peterborough_(AU),_Port_Campbell_National_Park,_Worm_Bay_--_2019_--_0863.jpg) — Dietmar Rabich; [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0); resized to 1600×1067, converted to webp, metadata removed.
- [Princetown (AU), Port Campbell National Park, Twelve Apostles -- 2019 -- 0930](https://commons.wikimedia.org/wiki/File:Princetown_(AU),_Port_Campbell_National_Park,_Twelve_Apostles_--_2019_--_0930.jpg) — Dietmar Rabich; [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0); resized to 1600×1067, converted to webp, metadata removed.
- [Waves at La Corniche](https://commons.wikimedia.org/wiki/File:Waves_at_La_Corniche.jpg) — Christian Ferrer; [CC BY 4.0](https://creativecommons.org/licenses/by/4.0); resized to 1600×1068, converted to webp, metadata removed.
- [Utah Dunes Landscape - West Desert District](https://commons.wikimedia.org/wiki/File:Utah_Dunes_Landscape_-_West_Desert_District.jpg) — Bureau of Land Management - Utah/Bob Wick; [Public domain](https://commons.wikimedia.org/wiki/File:Utah_Dunes_Landscape_-_West_Desert_District.jpg); resized to 1600×1051, converted to webp, metadata removed.
- [Milky Way over dunes in Great Sand Dunes National Park, Colorado, United States](https://commons.wikimedia.org/wiki/File:Milky_Way_over_dunes_in_Great_Sand_Dunes_National_Park,_Colorado,_United_States.jpg) — NPS/Patrick Myers; [Public domain](https://commons.wikimedia.org/wiki/File:Milky_Way_over_dunes_in_Great_Sand_Dunes_National_Park,_Colorado,_United_States.jpg); resized to 1600×1200, converted to webp, metadata removed.
- [Sossusvlei Dune Rippled cropped](https://commons.wikimedia.org/wiki/File:Sossusvlei_Dune_Rippled_cropped.jpg) — Daniel Kraft; [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0); resized to 1600×955, converted to webp, metadata removed.
- [Vietnam, Mui Ne sand dunes, trees on the sand](https://commons.wikimedia.org/wiki/File:Vietnam,_Mui_Ne_sand_dunes,_trees_on_the_sand.jpg) — Vyacheslav Argenberg; [CC BY 4.0](https://creativecommons.org/licenses/by/4.0); resized to 1600×1067, converted to webp, metadata removed.
- [006 Dune 45 in Sossusvlei at sunrise Photo by Giles Laurent](https://commons.wikimedia.org/wiki/File:006_Dune_45_in_Sossusvlei_at_sunrise_Photo_by_Giles_Laurent.jpg) — Giles Laurent; [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0); resized to 1600×1067, converted to webp, metadata removed.
- [Elakala Waterfalls Swirling Pool Mossy Rocks](https://commons.wikimedia.org/wiki/File:Elakala_Waterfalls_Swirling_Pool_Mossy_Rocks.jpg) — Forest Wander from Cross Lanes; [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0); resized to 1600×1235, converted to webp, metadata removed.
- [Klonglan waterfall 03](https://commons.wikimedia.org/wiki/File:Klonglan_waterfall_03.jpg) — Khunkay; [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0); resized to 1600×1067, converted to webp, metadata removed.
- [Waterfall in Russian Gulch State Park](https://commons.wikimedia.org/wiki/File:Waterfall_in_Russian_Gulch_State_Park.jpg) — Frank Schulenburg; [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0); resized to 1600×1142, converted to webp, metadata removed.
- [Bhorley waterfall of Dolakha and Tamakoshi river as seen from above](https://commons.wikimedia.org/wiki/File:Bhorley_waterfall_of_Dolakha_and_Tamakoshi_river_as_seen_from_above.jpg) — Nammy Hang Kirat; [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0); resized to 1600×1199, converted to webp, metadata removed.
- [Skógafoss Waterfall, Iceland, 20240720 1318 2975](https://commons.wikimedia.org/wiki/File:Sk%C3%B3gafoss_Waterfall,_Iceland,_20240720_1318_2975.jpg) — Jakub Hałun; [CC BY 4.0](https://creativecommons.org/licenses/by/4.0); resized to 1600×1068, converted to webp, metadata removed.
- [California Gold Field At Antelope Valley (8439055)](https://commons.wikimedia.org/wiki/File:California_Gold_Field_At_Antelope_Valley_(8439055).jpg) — Dawn Endico from Menlo Park, California; [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0); resized to 1600×1200, converted to webp, metadata removed.
- [Haltern am See, Westruper Heide -- 2015 -- 7965-9](https://commons.wikimedia.org/wiki/File:Haltern_am_See,_Westruper_Heide_--_2015_--_7965-9.jpg) — Dietmar Rabich; [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0); resized to 1600×1068, converted to webp, metadata removed.
- [Field of yellow flowers in Laurensberg (DSCF5908)](https://commons.wikimedia.org/wiki/File:Field_of_yellow_flowers_in_Laurensberg_(DSCF5908).jpg) — Trougnouf (Benoit Brummer); [CC BY 4.0](https://creativecommons.org/licenses/by/4.0); resized to 1600×1068, converted to webp, metadata removed.
- [Custer-Gallatin National Forest, Emigrant Peak Trail, alpine wildflowers - Flickr - YellowstoneNPS](https://commons.wikimedia.org/wiki/File:Custer-Gallatin_National_Forest,_Emigrant_Peak_Trail,_alpine_wildflowers_-_Flickr_-_YellowstoneNPS.jpg) — Yellowstone National Park; [Public domain](https://commons.wikimedia.org/wiki/File:Custer-Gallatin_National_Forest,_Emigrant_Peak_Trail,_alpine_wildflowers_-_Flickr_-_YellowstoneNPS.jpg); resized to 1600×1067, converted to webp, metadata removed.
- [2013-07-14 13 26 56 Alpine wildflowers near the summit of Wheeler Peak in Great Basin National Park](https://commons.wikimedia.org/wiki/File:2013-07-14_13_26_56_Alpine_wildflowers_near_the_summit_of_Wheeler_Peak_in_Great_Basin_National_Park.jpg) — Famartin; [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0); resized to 1600×1200, converted to webp, metadata removed.
- [Red fox (Vulpes vulpes crucigera) Skalnate Pleso 2](https://commons.wikimedia.org/wiki/File:Red_fox_(Vulpes_vulpes_crucigera)_Skalnate_Pleso_2.jpg) — Charles J. Sharp; [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0); resized to 1600×1067, converted to webp, metadata removed.
- [African bush elephants (Loxodonta africana) female with six-week-old baby](https://commons.wikimedia.org/wiki/File:African_bush_elephants_(Loxodonta_africana)_female_with_six-week-old_baby.jpg) — Charles J. Sharp; [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0); resized to 1600×1067, converted to webp, metadata removed.
- [European bee-eaters (Merops apiaster) with dragonflies](https://commons.wikimedia.org/wiki/File:European_bee-eaters_(Merops_apiaster)_with_dragonflies.jpg) — Charles J. Sharp; [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0); resized to 1600×1067, converted to webp, metadata removed.
- [Humpback Whale amidst icebergs (6296029124)](https://commons.wikimedia.org/wiki/File:Humpback_Whale_amidst_icebergs_(6296029124).jpg) — Liam Quinn from Canada; [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0); resized to 1600×1169, converted to webp, metadata removed.
- [Whale Shark AdF](https://commons.wikimedia.org/wiki/File:Whale_Shark_AdF.jpg) — Arturo de Frias Marques; [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0); resized to 1600×1067, converted to webp, metadata removed.
- [Aurora borealis over Eielson Air Force Base, Alaska](https://commons.wikimedia.org/wiki/File:Aurora_borealis_over_Eielson_Air_Force_Base,_Alaska.jpg) — United States Air Force photo by Senior Airman Joshua Strang; [Public domain](https://commons.wikimedia.org/wiki/File:Aurora_borealis_over_Eielson_Air_Force_Base,_Alaska.jpg); resized to 1600×1042, converted to webp, metadata removed.
- [The aurora borealis blankets the Earth (iss072e159516)](https://commons.wikimedia.org/wiki/File:The_aurora_borealis_blankets_the_Earth_(iss072e159516).jpg) — NASA Johnson Space Center; [Public domain](https://commons.wikimedia.org/wiki/File:The_aurora_borealis_blankets_the_Earth_(iss072e159516).jpg); resized to 1600×1067, converted to webp, metadata removed.
- [Aerial photography mountain glacier landscape with snow](https://commons.wikimedia.org/wiki/File:Aerial_photography_mountain_glacier_landscape_with_snow.jpg) — Hillebrand Steve, U.S. Fish and Wildlife Service; [Public domain](https://commons.wikimedia.org/wiki/File:Aerial_photography_mountain_glacier_landscape_with_snow.jpg); resized to 1600×1065, converted to webp, metadata removed.
- [View of the glacier of Öræfajökull volcano in Hornafjörður municipality, Iceland, 20240719 1738 2793](https://commons.wikimedia.org/wiki/File:View_of_the_glacier_of_%C3%96r%C3%A6faj%C3%B6kull_volcano_in_Hornafj%C3%B6r%C3%B0ur_municipality,_Iceland,_20240719_1738_2793.jpg) — Jakub Hałun; [CC BY 4.0](https://creativecommons.org/licenses/by/4.0); resized to 1600×879, converted to webp, metadata removed.
- [Towering Rows of Crevasses - Knik Glacier in Alaska](https://commons.wikimedia.org/wiki/File:Towering_Rows_of_Crevasses_-_Knik_Glacier_in_Alaska.jpg) — Eric Kilby; [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0); resized to 1600×1067, converted to webp, metadata removed.
- [Earth's City Lights by DMSP, 1994-1995 (large)](https://commons.wikimedia.org/wiki/File:Earth's_City_Lights_by_DMSP,_1994-1995_(large).jpg) — Data: Marc Imhoff/NASA GSFC, Christopher Elvidge/NOAA NGDC; Image: Craig Mayhew and Robert Simmon/NASA GSFC; [Public domain](https://commons.wikimedia.org/wiki/File:Earth's_City_Lights_by_DMSP,_1994-1995_(large).jpg); resized to 1600×800, converted to webp, metadata removed.
- [Top of Atmosphere](https://commons.wikimedia.org/wiki/File:Top_of_Atmosphere.jpg) — NASA Earth Observatory; [Public domain](https://commons.wikimedia.org/wiki/File:Top_of_Atmosphere.jpg); resized to 1600×1062, converted to webp, metadata removed.
- [International Space Station star trails - JSC2012E039800](https://commons.wikimedia.org/wiki/File:International_Space_Station_star_trails_-_JSC2012E039800.jpg) — NASA/Don Pettit; [Public domain](https://commons.wikimedia.org/wiki/File:International_Space_Station_star_trails_-_JSC2012E039800.jpg); resized to 1600×1065, converted to webp, metadata removed.
- [Good Morning From the International Space Station](https://commons.wikimedia.org/wiki/File:Good_Morning_From_the_International_Space_Station.jpg) — Scott Kelly; [Public domain](https://commons.wikimedia.org/wiki/File:Good_Morning_From_the_International_Space_Station.jpg); resized to 1600×1065, converted to webp, metadata removed.
- [Earth From the Perspective of Artemis II](https://commons.wikimedia.org/wiki/File:Earth_From_the_Perspective_of_Artemis_II.jpg) — Reid Wiseman /NASA; [Public domain](https://commons.wikimedia.org/wiki/File:Earth_From_the_Perspective_of_Artemis_II.jpg); resized to 1600×1067, converted to webp, metadata removed.
<!-- browser-surface-third-party:end -->
