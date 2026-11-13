# Android: an outset `boxShadow` whose negative spread empties its shape paints a bar outside the view

React Native 0.90.0-nightly-20261113-6d587e873, from the [React Native reproducer template](https://github.com/react-native-community/reproducer-react-native). `App.tsx` renders three 100×50 boxes on a white screen:

- `boxShadow: '0 40px 0 -30px black'`: the spread takes 30 off each side, more than half the box's height, so the shadow's shape is empty and CSS paints nothing.
- the same shadow with `borderRadius: 8`.
- `boxShadow: '0 40px 0 -20px black'`, the control: its shape is 60×10, and it paints 10 below the box.

## Steps

By hand, on an Android 9 or newer device:

1. Build and install the release APK: `cd ReproducerApp && yarn install && cd android && ./gradlew assembleRelease && adb install -r app/build/outputs/apk/release/app-release.apk`.
2. Open the app. Each of the first two boxes paints a black 40×10 bar 10 below itself, where nothing should be painted; the third paints its 60×10 shape, as it should.

Scripted: `./reproduce.sh`, with one Android 9 or newer device attached, builds and installs the app, takes a screenshot and counts the dark pixels in the 30 below each box. It exits 1 while a box whose spread empties its shadow shape paints anything there, 0 once neither does, and 2 when the control paints no shape or a step fails. The screenshot lands in `screenshots/`.
