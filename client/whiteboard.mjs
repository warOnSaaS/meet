// The whiteboard's libraries, bundled into public/vendor/wb/ by scripts/build-client.mjs: Excalidraw (MIT)
// with React (MIT), and Yjs (MIT) to merge everyone's drawing. Loaded only when someone opens a whiteboard.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw, exportToSvg, exportToBlob, restoreElements } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import * as Y from 'yjs';

export { React, createRoot, Excalidraw, exportToSvg, exportToBlob, restoreElements, Y };
