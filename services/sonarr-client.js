const axios = require('axios');

class SonarrClient {
  constructor(config) {
    this.baseUrl = config.sonarr.url;
    this.apiKey = config.sonarr.apiKey;
  }

  async listSeries() {
    try {
      const response = await axios.get(`${this.baseUrl}/api/v3/series`, {
        headers: { 'X-Api-Key': this.apiKey }
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch series from Sonarr: ${error.message}`);
    }
  }

  async deleteSeries(titleSlug) {
    try {
      const deleteUrl = `${this.baseUrl}/api/v3/series/${titleSlug}?deleteFiles=true&addImportExclusion=false`;
      
      await axios.delete(deleteUrl, {
        headers: { 'X-Api-Key': this.apiKey }
      });
      
      return true;
    } catch (error) {
      throw new Error(`Failed to delete series ${titleSlug} from Sonarr: ${error.message}`);
    }
  }
}

module.exports = SonarrClient;
