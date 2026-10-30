# Home-screen widget (future work)

A home-screen widget is NOT possible in the Expo managed workflow: it needs native code. Nothing is faked in the app today.

1. Create a dev build: `npx expo prebuild` (or EAS Build with a development profile).
2. Keep the widget tiny and private: show only a soft prompt ("One deep breath?") and a deep link, never mood data or journal text.
3. Android (App Widget): add an `AppWidgetProvider` in Kotlin, a layout in `res/layout`, an `appwidget-provider` XML in `res/xml`, and register the receiver in `AndroidManifest.xml`. Wire the tap to the deep link `nivora://exercise/breathing` through a `PendingIntent`.
4. iOS (WidgetKit): add a Widget Extension target in Xcode, write a SwiftUI `TimelineProvider` plus a `Widget`, and enable an App Group if you ever share small values with the app. Use `widgetURL(...)` for the same deep link.
5. In Expo, a config plugin (see `expo-apple-targets`, or `react-native-android-widget`) can generate these targets so prebuild stays repeatable.
6. Make sure the deep link scheme is set in `app.json` and handled by the React Navigation `linking` config.
7. Respect the app lock: the widget must open the app (which shows the lock screen), not display content itself.
8. Refresh sparingly (hourly at most) to protect battery; do not fetch from the network inside the widget.
9. Test on a real device; widgets do not run in Expo Go or on web.
10. Follow the same soft, non-shaming wording as notifications, and offer a bilingual (English/Bangla) label.
