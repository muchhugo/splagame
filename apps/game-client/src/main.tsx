import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import '@fontsource/fredoka/latin-500.css';
import '@fontsource/fredoka/latin-600.css';
import '@fontsource/fredoka/latin-700.css';
import './ui/styles.css';

createRoot(document.getElementById('root')!).render(<App />);
