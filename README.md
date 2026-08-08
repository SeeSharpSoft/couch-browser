# Padflix

<p align="center">
  <a href="https://chromewebstore.google.com/detail/couch-browser-gamepad-sup/pjmhfjdepmaglpjpgaigbaabmmjagbmf">
    <strong>🕹️ Get Couch Browser for Chrome</strong><br>
    <sub>Install it from the Chrome Web Store</sub>
  </a>
</p>

Padflix is a Chrome extension that enables **universal gamepad navigation for any webpage**. A central navigation engine highlights selectable UI elements and lets you move between them with the gamepad, while site-specific files only provide selectors and small behaviour tweaks.

## Features

- **Universal Navigation**: Works on any website, not just streaming sites. Links, buttons, inputs, ARIA roles and other interactive elements are detected automatically.
- **History Navigation**: Shoulder buttons go back/forward in the browser history (or switch tabs when the right trigger is held).
- **Cursor Mode**: Hold the right trigger to move a virtual mouse cursor with the left stick and click with A — for elements that aren't reachable via selection. The real OS cursor is hidden while you use the gamepad (so it no longer triggers stray hover effects) and reappears when you move the mouse.
- **Visual Selection Indicator**: A highlight border is drawn around the currently selected element. Themeable per site (green by default, Netflix red on Netflix).
- **Connection Indicator**: A gamepad icon appears in the top-right corner of the page. It turns green when a gamepad is connected and active.
- **Spatial Navigation**: Move between on-screen elements based on their physical layout.
- **Overlay Scoping**: When a modal/overlay/popup is open, navigation stays inside it so selection never lands on a layer behind it.
- **Nested Drill-in**: Press **X** to drill into interactive elements nested inside the current one (e.g. links inside a clickable image); press **B** to drill back out.
- **Virtual Keyboard**: Press **A** while a text input, textarea or editable field is selected to open an on-screen keyboard. The keyboard has a conventional layout, shows the active **X**, **Y** and **LT** controller badges, and temporarily takes over gamepad focus until it is closed.
- **Key Mapping**:
  - **Left stick / D-pad**: spatial navigation between elements
  - **A**: Enter / click the selected element
  - **B**: Escape / back (close overlay, exit drill-in, or dispatch Escape)
  - **X**: drill into nested interactive elements
  - **Left shoulder (LB)**: browser **back** (or **previous tab** while the right trigger is held)
  - **Right shoulder (RB)**: browser **forward** (or **next tab** while the right trigger is held)
  - **Right trigger (RT, hold)**: cursor mode — the left stick moves a virtual mouse cursor, **A** performs a mouse click at the cursor, and **LB/RB** switch browser tabs
  - **Y while holding RT**: reload the current browser tab
  - **Right stick**: scroll up/down and left/right

### Virtual keyboard controls

While the virtual keyboard is open:

- **Left stick / D-pad**: navigate between virtual keys
- **A**: activate the highlighted key
- **B**: close the keyboard
- **X**: activate Enter and close the keyboard
- **Y**: Backspace
- **LT**: hold for shifted characters, such as uppercase letters and symbols
- **RT**: show the virtual cursor; moving it over a key highlights that key and **A** activates it
- **Right stick**: move the caret in the active input field using arrow-key behavior

The webpage cannot be navigated or scrolled with the gamepad while the keyboard is open. Press **B**, select the **Enter** key, or press **X** to hide it.

## Installation

Since this extension is currently in development, you need to load it as an "unpacked" extension in Google Chrome:

1.  **Download/Clone** this repository to your local machine.
2.  Open **Chrome** and navigate to `chrome://extensions/`.
3.  Enable **Developer mode** using the toggle switch in the top-right corner.
4.  Click the **Load unpacked** button.
5.  Select the folder containing this project (the folder where `manifest.json` is located).
6.  **Pin the extension**: For easy access, click the puzzle piece icon in Chrome and "pin" Padflix to your toolbar.

## Usage

1.  Connect a compatible gamepad to your computer.
2.  Navigate to any website. The current element is highlighted automatically.
3.  **Check Status**: Click the Padflix icon in your toolbar. It should show "Gamepad: Connected".
4.  Use the **left stick / D-pad** to move the highlight between elements.
5.  Press **A** to click/activate the selected element, **B** to go back / close an overlay, and **X** to drill into nested interactive elements.
6.  Press the **left/right shoulder** buttons to navigate browser history (back/forward).
7.  Hold the **right trigger** to enter cursor mode: move the mouse cursor with the left stick and press **A** to click wherever the cursor is. While the trigger is held, the **left/right shoulder** buttons switch to the previous/next browser tab.
8.  Press **Y while holding RT** to reload the current browser tab.
9.  Use the **right stick** to scroll the page (or the nearest scrollable container).
10. When a text input is selected, press **A** to open the virtual keyboard and use the controls described above to enter text.

*Note: Navigation, activation and scrolling are all handled by the central engine (`core.js`) acting on its own tracked selection, independent of native `document.activeElement` quirks.*

## Development

For technical implementation details, design decisions, and project structure, please refer to [DEVELOPMENT.md](./DEVELOPMENT.md).

## License

MIT
