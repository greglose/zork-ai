# Interactive fiction game files

## Zork I (`public/zork1.z3`)

- Source: https://github.com/historicalsource/zork1 (Microsoft's MIT-licensed release of the ZIL source), commit `97b7b3d68c075dd9af7da499c3e9690ada3471fd`.
- License: MIT, Copyright (c) 2025 Microsoft. Text in `public/LICENSE-ZORK.txt` (SHA-256 `98a96c38494df4963951e32b81ec4effebe4c8a812ab8d9e7d185d59e86fe2fc`).
- Built from the `.zil` files only. The repo's `COMPILED/` folder and `zork1.zip` were NOT used.
- Compiler: ZILF (https://github.com/taradinoc/zilf, mirror of foss.heptapod.net/zilf/zilf), commit `12744846a899afb995c66f91701009ec912c5f03`, built with .NET 10 (`brew install dotnet`).
  The compiler is GPL-3 (COPYING.txt); its runtime-library license (LICENSE.RTL.txt) covers only Glulx/Cornerstone output, not Z3.
- Build:
  ```
  dotnet build src/Zilf/Zilf.csproj -c Release -o zilfbin
  dotnet build src/Zapf/Zapf.csproj -c Release -o zilfbin
  cp <zork1 repo>/*.zil work/ && cd work
  dotnet ../zilfbin/zilf.dll build -q -I <zilf repo>/zillib zork1.zil zork1.z3
  ```
  Compiles without edits (warnings only: tab in Z3 strings).
- SHA-256 `zork1.z3`: `98a6de357d893fab4fb656f6ee3b572b5404bb55efe6a90bcb3b5d3478aeb081` (84258 bytes). Banner: "Release 0 / Serial number 261020" (the serial is the build date; rebuilding changes the hash).

## Colossal Cave Adventure (350 points)

BLOCKED. No Z-machine build with a clear web-redistribution license was identified. The only Z-machine builds found
(Graham Nelson's Inform port, shipped as `advent.z3`/`advent.z5` test fixtures in the `glkote-term` npm package)
carry no stated license of their own and derive from Crowther/Woods' original, which has no explicit license. Not shipped;
skip all Adventure steps in later tasks (ship Zork only). Nothing is placed under `public/games/adventure/`.

## ifvms

- Dependency: `ifvms` ^1.1.6 (MIT). Pulls `glkote-term` 0.4.4 (MIT), which supplies the Glk API (`Glk`).
- Entry points actually used (verified with a scratch script, not in the repo):
  - `const { ZVM } = require('ifvms')`; `const { Glk } = require('glkote-term')`
  - `const vm = new ZVM(); vm.prepare(storyBytes, options); Glk.init(options)` where `options = { vm, Dialog, Glk, GlkOte }`.
  - `GlkOte` is our own object with `init(iface)`, `update(data)`, `error()`, `log()`, `warning()`. On `init` call `iface.accept({type:'init', gen:0, metrics, support:[]})`.
    `metrics` MUST include every field (`buffermarginx/y`, `gridmarginx/y`, char sizes, `width`, `height`, spacings); missing margins give NaN and a
    `RangeError: Invalid array length` in `v3_status`.
  - Each `update(data)` carries `gen`, `windows` (grid = status line, buffer = story text), `content`, and `input`. Reply with
    `iface.accept({type:'line', gen: data.gen, window: input.id, value: 'look'})`.
  - Z3 status line arrives as a grid window line: location, then `Score: N  Turns: M`.
- Smoke test result: after the `look` command the buffer text contains "West of House" and the status line reads `West of House ... Score: 0  Turns: 1`.
