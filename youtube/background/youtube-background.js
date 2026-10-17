(function (global) {
  'use strict';

  const { fetchYouTubeImageDataUrlWithFallback } = global.TMYouTubeImages;
  const scrape = global.TMYouTubeScrape;

  const handlers = {
    async FETCH_YOUTUBE_IMAGE({ url, videoId }) {
      const dataUrl = await fetchYouTubeImageDataUrlWithFallback([
        url,
        videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : null,
        videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null,
        videoId ? `https://i.ytimg.com/vi/${videoId}/default.jpg` : null
      ]);
      return { dataUrl };
    },
    async YOUTUBE_SEARCH({ query }) {
      return { data: await scrape.searchChannels(query) };
    },
    async YOUTUBE_RESOLVE({ input }) {
      return { data: await scrape.resolveInput(input) };
    },
    async YOUTUBE_CATALOG_PAGE(payload) {
      return { data: await scrape.loadCatalogPage(payload) };
    },
    async YOUTUBE_VIDEO_DETAILS({ videoId }) {
      return { data: await scrape.loadVideoDetails(videoId) };
    }
  };
  global.TMYouTubeBackground = { handlers };
})(typeof self !== 'undefined' ? self : this);
