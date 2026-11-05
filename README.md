# MRU Tab Switcher for Edge v2


## How it works

When the first shortcut is pressed, the extension freezes the current MRU list as a snapshot. Repeated shortcut presses walk through that snapshot instead of treating each extension-triggered activation as a new user visit.

After 1.2 seconds without another shortcut press, the cycle ends. A normal user-driven tab activation also ends the cycle and updates MRU history.

Default shortcuts:
- Alt+Q: forward through MRU snapshot
- Alt+Shift+Q: backward

Edge/Chromium extensions cannot bind Ctrl+Tab because Tab is not a supported Commands API key and browser shortcuts take precedence.
