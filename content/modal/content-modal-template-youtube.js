(function (global) {
  'use strict';

  function renderYouTubeControls() {
    return {
      controlsHtml: `
        <div class="tm-youtube-layout">
          <div class="tm-youtube-filters-card">
            <fieldset class="tm-youtube-formats">
              <legend>Format</legend>
              <div class="tm-youtube-filter-row">
                <label class="tm-youtube-format">
                  <input type="checkbox" id="tm-youtube-include-long">
                  <span>Videos &amp; directs</span>
                </label>
                <label class="tm-youtube-format">
                  <input type="checkbox" id="tm-youtube-include-shorts">
                  <span>Shorts</span>
                </label>
              </div>
            </fieldset>
            <div class="tm-youtube-section-header">
              <strong>Periode</strong><span>Facultatif</span>
            </div>
            <div class="tm-youtube-controls-grid">
              <div class="tm-field">
                <label for="tm-youtube-from-date">Du</label>
                <input type="date" id="tm-youtube-from-date" max="${new Date().toISOString().slice(0, 10)}" title="Filtrer par date peut ralentir le chargement.">
              </div>
              <div class="tm-field">
                <label for="tm-youtube-to-date">Au</label>
                <input type="date" id="tm-youtube-to-date" max="${new Date().toISOString().slice(0, 10)}" title="Filtrer par date peut ralentir le chargement.">
              </div>
            </div>
          </div>
        </div>`,
      searchPanelHtml: `
        <div class="tm-youtube-add-source">
          <div class="tm-field tm-search-field">
            <label for="tm-search-input">Chaine ou playlist</label>
            <input type="text" id="tm-search-input" autocomplete="off" placeholder="Nom, @pseudo ou URL YouTube" aria-controls="tm-search-results">
            <div id="tm-search-results" class="tm-search-results" style="display:none"></div>
          </div>
          <button type="button" id="tm-youtube-add-btn" class="tm-btn">Ajouter</button>
        </div>`
    };
  }

  Object.assign(global.TMContent, { renderYouTubeControls });
})(typeof window !== 'undefined' ? window : this);
