/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        maersk: {
          50: '#e6f0fa',
          100: '#cce1f5',
          200: '#99c3eb',
          300: '#66a5e1',
          400: '#3387d7',
          500: '#0069cd',
          600: '#0054a3',
          700: '#003f79',
          800: '#002a4f',
          900: '#001525',
          primary: '#003365',
          dark: '#002B5C',
          accent: '#00A1E5',
          light: '#e8f4fc',
          success: '#3d8b40',
          warning: '#f5a623',
          error: '#d0021b',
        },
      },
      fontFamily: {
        sans: [
          'Maersk',
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
