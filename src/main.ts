import { startApp } from './ui/app';

const root = document.getElementById('app');
const toasts = document.getElementById('toasts');
if (!root || !toasts) throw new Error('index.html is missing #app or #toasts');

startApp(root, toasts);
