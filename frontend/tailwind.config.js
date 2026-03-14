/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        surface: '#f6f4ee',
        ink: '#1f232a',
      },
      boxShadow: {
        panel: '0 1px 3px rgba(15,23,42,0.06), 0 4px 16px rgba(15,23,42,0.06)',
        card: '0 1px 2px rgba(15,23,42,0.05), 0 2px 8px rgba(15,23,42,0.05)',
        'button-primary': '0 1px 3px rgba(79,70,229,0.3)',
      },
    },
  },
  plugins: [],
};
