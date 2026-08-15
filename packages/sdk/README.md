# @spup/sdk

The API a [Shy's Power-Up Factory](https://spupgame.com) mod is written against.

```js
import {AbstractModDeclaration, ObjectType, GeneratorBehavior, Direction} from "@spup/sdk";
import {AbstractClientMod, Container, Sprite} from "@spup/sdk/client";
```

`@spup/sdk` is everything a mod's data and server-side code needs; `@spup/sdk/client` adds the
browser-only half (drawing, input) and re-exports all of the above, so client files need only the
one import.

## Versioning

The major is the SDK version a mod declares and a server checks: any `2.x` client and server run a
mod built against `@spup/sdk@2`. Minors add exports.
