const axios = require('axios');

class RadarrClient {
  constructor(config) {
    this.baseUrl = config.radarr.url;
    this.apiKey = config.radarr.apiKey;
  }

  async listMovies() {
    try {
      const response = await axios.get(`${this.baseUrl}/api/v3/movie`, {
        headers: { 'X-Api-Key': this.apiKey }
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch movies from Radarr: ${error.message}`);
    }
  }

  async deleteMovie(titleSlug) {
    try {
      const deleteUrl = `${this.baseUrl}/api/v3/movie/${titleSlug}?deleteFiles=true&addImportExclusion=false`;
      
      await axios.delete(deleteUrl, {
        headers: { 'X-Api-Key': this.apiKey }
      });
      
      return true;
    } catch (error) {
      throw new Error(`Failed to delete movie ${titleSlug} from Radarr: ${error.message}`);
    }
  }
}

module.exports = RadarrClient;
