// Profile configuration — edit values here, then run `npm run build`.

export default {
  // GitHub
  username: 'akifkomurcu',

  // Terminal prompt: name@host
  name: 'akif',
  host: 'komurcu',

  // Fallback GitHub join date (overridden by the live API when reachable)
  uptimeStartDate: '2020-01-01',

  // Professional info
  role: 'Full Stack Developer',
  kernel: 'React, React Native, Angular, NestJS',
  databases: 'PostgreSQL, MongoDB, Supabase',
  devops: 'Docker, Jenkins, Nginx, Linux',

  // Skills
  languagesCode: 'TypeScript, JavaScript, Swift',
  frontend: 'React, React Native, Angular, Tailwind',
  backend: 'NestJS, Node.js, Python, REST APIs',
  native: 'Swift (macOS/iOS), Kotlin (Android)',
  tools: 'Git, GitHub Actions, Xcode, Postman',
  focus: 'Web + Mobile Product Engineering',

  // Featured projects — rendered as their own terminal-style card
  // (projects_dark.svg / projects_light.svg), same visual language as the
  // stats card above. `url` isn't shown on the card (links don't work once
  // an SVG is embedded via <img>) but is kept here for reference.
  projects: [
    {
      name: 'Apptionly',
      url: 'https://apptionly.com/',
      tech: 'React 19, Zustand, Tailwind 4, Supabase',
      description: 'App Store screenshot generator: canvas rendering, undo/redo, PWA.',
    },
    {
      name: 'maarifhan',
      url: 'https://github.com/akifkomurcu/maarifhan',
      tech: 'Angular',
      description: 'AI-supported education platform.',
    },
    {
      name: 'maarifhan-be',
      url: 'https://github.com/akifkomurcu/maarifhan-be',
      tech: 'NestJS',
      description: 'Backend for maarifhan.',
    },
    {
      name: 'TapLocks',
      url: 'https://github.com/akifkomurcu/TapLocks',
      tech: 'Swift',
      description: 'Lets you easily lock your screen. macOS app.',
    },
    {
      name: 'Shelf',
      url: 'https://github.com/akifkomurcu/shelf',
      tech: 'Swift',
      description: 'macOS menu bar icon manager, native Command+Drag.',
    },
    {
      name: 'Moon Tracker',
      url: 'https://apps.apple.com/tr/app/ay-g%C3%B6zlemcisi/id6755927447?l=tr',
      tech: 'React Native',
      description: 'iOS moon phase/lunar cycle tracker.',
    },
    {
      name: 'FloatX (Sliding Apps)',
      url: 'https://github.com/akifkomurcu/sliding-apps',
      tech: 'Kotlin',
      description: 'Android floating multitasking hub.',
    },
    {
      name: 'Product Alarm',
      url: 'https://github.com/akifkomurcu/product-alarm',
      tech: 'Python, Docker',
      description: 'Price-tracking scraper (Akakçe, Trendyol, Hepsiburada) with Telegram alerts.',
    },
    {
      name: 'idm-cli',
      url: 'https://github.com/akifkomurcu/idm-cli',
      tech: 'Python',
      description: 'Download tool like idm, works on terminal.',
    },
  ],
};
