/**
 * Global test setup for Vitest.
 *
 * Installs a fresh `browser` mock and `fetch` mock before every test.
 * Individual tests override specific methods with `vi.fn()` as needed.
 */

import { vi, beforeEach, afterEach } from "vitest";

/**
 * Build a fresh mock implementation of the WebExtension `browser` namespace.
 * Returned each beforeEach so tests start with no residual state.
 */
export function makeBrowserMock() {
  const listeners = {
    runtimeMessage: [],
    runtimeConnect: [],
    storageChanged: [],
    webNavigationCompleted: [],
    contextMenusClicked: [],
  };

  const mock = {
    runtime: {
      onMessage: {
        addListener: vi.fn((fn) => listeners.runtimeMessage.push(fn)),
        removeListener: vi.fn((fn) => {
          const i = listeners.runtimeMessage.indexOf(fn);
          if (i >= 0) listeners.runtimeMessage.splice(i, 1);
        }),
        hasListener: vi.fn((fn) => listeners.runtimeMessage.includes(fn)),
      },
      onConnect: {
        addListener: vi.fn((fn) => listeners.runtimeConnect.push(fn)),
      },
      connect: vi.fn(),
      sendMessage: vi.fn(),
      openOptionsPage: vi.fn().mockResolvedValue(undefined),
    },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 1, url: "https://example.com", title: "Example" }]),
      get: vi.fn().mockResolvedValue({ id: 1, url: "https://example.com", title: "Example" }),
      sendMessage: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
      goBack: vi.fn().mockResolvedValue(undefined),
      captureVisibleTab: vi.fn().mockResolvedValue("data:image/png;base64,xxx"),
    },
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn().mockResolvedValue(undefined),
      },
      session: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      },
      onChanged: {
        addListener: vi.fn((fn) => listeners.storageChanged.push(fn)),
      },
    },
    webNavigation: {
      onCompleted: {
        addListener: vi.fn((fn) => listeners.webNavigationCompleted.push(fn)),
        removeListener: vi.fn((fn) => {
          const i = listeners.webNavigationCompleted.indexOf(fn);
          if (i >= 0) listeners.webNavigationCompleted.splice(i, 1);
        }),
      },
    },
    contextMenus: {
      create: vi.fn(),
      onClicked: {
        addListener: vi.fn((fn) => listeners.contextMenusClicked.push(fn)),
      },
    },
    sidebarAction: {
      open: vi.fn().mockResolvedValue(undefined),
    },
    scripting: {
      executeScript: vi.fn().mockResolvedValue([]),
    },
    downloads: {
      download: vi.fn().mockResolvedValue(1),
    },
    windows: {
      getCurrent: vi.fn().mockResolvedValue({ id: 1 }),
    },
  };

  // Expose listener arrays so tests can drive events
  mock.__listeners = listeners;
  return mock;
}

/**
 * Build a fresh fetch mock that returns 200 OK with empty JSON by default.
 * Individual tests override .mockResolvedValueOnce(...) to control behavior.
 */
export function makeFetchMock() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    json: vi.fn().mockResolvedValue({}),
    text: vi.fn().mockResolvedValue(""),
  });
}

/**
 * Helper: build a fetch Response stub for use with .mockResolvedValueOnce.
 */
export function fetchResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(typeof body === "string" ? body : JSON.stringify(body)),
  };
}

beforeEach(() => {
  vi.stubGlobal("browser", makeBrowserMock());
  vi.stubGlobal("fetch", makeFetchMock());
  // jsdom does not implement CSS.escape in all environments — polyfill if missing
  if (typeof globalThis.CSS === "undefined") {
    globalThis.CSS = { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => "\\" + c) };
  } else if (typeof globalThis.CSS.escape !== "function") {
    globalThis.CSS.escape = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => "\\" + c);
  }

  // jsdom does not implement DataTransfer or DragEvent. Provide a minimal
  // polyfill sufficient for the sensor's drag-and-drop and file-upload tools.
  if (typeof globalThis.DataTransfer === "undefined") {
    globalThis.DataTransfer = class DataTransfer {
      constructor() {
        const list = [];
        list.add = (file) => list.push(file);
        this.items = list;
        Object.defineProperty(this, "files", { get: () => list });
      }
    };
  }
  if (typeof globalThis.DragEvent === "undefined") {
    globalThis.DragEvent = class DragEvent extends Event {
      constructor(type, init = {}) {
        super(type, init);
        this.clientX = init.clientX || 0;
        this.clientY = init.clientY || 0;
        this.dataTransfer = init.dataTransfer || null;
      }
    };
  }

  // jsdom's HTMLInputElement.files setter rejects non-FileList values. The
  // sensor uses DataTransfer.files (which is a real FileList in real browsers
  // but an array under our polyfill). Override the setter on the prototype
  // for tests so production code can assign without conversion.
  if (typeof HTMLInputElement !== "undefined") {
    const orig = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files");
    Object.defineProperty(HTMLInputElement.prototype, "files", {
      configurable: true,
      get() {
        return this.__files || (orig && orig.get && orig.get.call(this)) || null;
      },
      set(v) {
        this.__files = v;
      },
    });
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
