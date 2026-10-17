(function (global) {
  'use strict';

  function request(type, payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, payload }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (!response) {
          reject(new Error('Le service YouTube ne repond pas.'));
        } else if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      });
    });
  }

  global.TMYouTubeNetwork = { request };
})(typeof window !== 'undefined' ? window : this);
