// Глобальные describe/it/expect для tsc: vitest запускается с globals: true
// (vitest.config.ts), но tsc сам по себе про глобалы vitest не знает — без этого
// референса `npm run typecheck` красный на любой свежей машине (Cannot find name
// 'describe'). Референс-файл вместо "types" в tsconfig.json: поле "types" отключило
// бы авто-подключение остальных @types/* (node, react и т.д.).
/// <reference types="vitest/globals" />
