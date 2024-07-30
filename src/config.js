export const CONFIG = {
  CACHE_DURATION: {
    BIRD_INFO: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
    BIRDS_BY_REGION: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
    RECENT_OBSERVATIONS: 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds
  },
  DEV_TAB_COUNT: 5,  // Number of new tabs to open before showing the prompt in dev mode
  PROD_TAB_COUNT: 50,  // Number of new tabs to open before showing the prompt in production
  DEV_TIME_DELAY: 1 * 60 * 1000,  // 1 minute in milliseconds
  PROD_TIME_DELAY: 4 * 24 * 60 * 60 * 1000,  // 4 days in milliseconds
  API_SERVER_URL: 'https://api.birdtab.app/api',
};

export default CONFIG;