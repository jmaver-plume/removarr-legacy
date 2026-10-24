const express = require('express');
const Database = require('../database/db');
const settingsService = require('../config/settings-service');
const RadarrClient = require('../services/radarr-client');
const SonarrClient = require('../services/sonarr-client');
const router = express.Router();

const db = new Database();

// Helper function to get clients with current config
function getClients() {
  const appConfig = settingsService.get();
  return {
    radarrClient: new RadarrClient(appConfig),
    sonarrClient: new SonarrClient(appConfig)
  };
}

// Get all pending media with current votes
router.get('/media', (req, res) => {
  db.getPendingMedia((err, media) => {
    if (err) {
      console.error('Error fetching media:', err);
      return res.status(500).json({ error: 'Failed to fetch media' });
    }

    if (media.length === 0) {
      return res.json([]);
    }

    // Create array to preserve order and track completion
    const mediaWithVotes = new Array(media.length);
    let processed = 0;

    media.forEach((item, index) => {
      db.getMediaVotes(item.id, (err, votes) => {
        if (err) {
          console.error('Error fetching votes:', err);
          votes = {};
        }

        mediaWithVotes[index] = {
          ...item,
          votes: votes // Object with voter_name -> vote mapping
        };

        processed++;
        if (processed === media.length) {
          // Sort by title to ensure consistent ordering
          mediaWithVotes.sort((a, b) => a.title.localeCompare(b.title));
          res.json(mediaWithVotes);
        }
      });
    });
  });
});

// Submit individual vote (auto-save)
router.post('/vote/individual', (req, res) => {
  const { mediaId, voterName, vote } = req.body;

  if (!mediaId || !voterName || !vote) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const validVoters = db.getVoters();
  if (!validVoters.includes(voterName)) {
    return res.status(400).json({ error: 'Invalid voter' });
  }

  const validVotes = ['yes', 'no'];
  if (!validVotes.includes(vote)) {
    return res.status(400).json({ error: 'Invalid vote value. Must be "yes" or "no"' });
  }

  db.submitVote(mediaId, voterName, vote, (err) => {
    if (err) {
      console.error('Error submitting vote:', err);
      return res.status(500).json({ error: 'Failed to submit vote' });
    }

    // Check if all voters voted to delete (no)
    db.checkAllVotesDelete(mediaId, (err, allVotedDelete) => {
      if (err) {
        console.error('Error checking votes:', err);
        return res.json({ success: true });
      }

      res.json({ 
        success: true, 
        readyForDeletion: allVotedDelete 
      });
    });
  });
});

// Delete media item (when all voters selected delete)
router.post('/delete/:id', (req, res) => {
  const mediaId = req.params.id;

  // First verify all voters voted to delete
  db.checkAllVotesDelete(mediaId, (err, allVotedDelete) => {
    if (err) {
      console.error('Error checking votes:', err);
      return res.status(500).json({ error: 'Failed to verify votes' });
    }

    if (!allVotedDelete) {
      return res.status(400).json({ error: 'Not all voters have selected delete' });
    }

    // Approve media for deletion
    db.approveMedia(mediaId, (err) => {
      if (err) {
        console.error('Error approving media:', err);
        return res.status(500).json({ error: 'Failed to approve media' });
      }

      // Get media details for deletion from Sonarr/Radarr
      db.db.get('SELECT * FROM media WHERE id = ?', [mediaId], async (err, media) => {
        if (err || !media) {
          console.error('Error fetching media for deletion:', err);
          return res.status(500).json({ error: 'Failed to fetch media details' });
        }

        try {
          const { radarrClient, sonarrClient } = getClients();
          await deleteFromSonarrRadarr(media, radarrClient, sonarrClient);
          res.json({ success: true, message: 'Media deleted successfully' });
        } catch (error) {
          console.error('Error deleting from Sonarr/Radarr:', error);
          res.status(500).json({ error: 'Failed to delete from Sonarr/Radarr' });
        }
      });
    });
  });
});

// Submit votes for multiple voters
router.post('/vote', (req, res) => {
  const { mediaId, votes } = req.body; // votes is an object: { "Petra": "yes", "Matej": "no" }

  if (!mediaId || !votes || typeof votes !== 'object') {
    return res.status(400).json({ error: 'Invalid vote data' });
  }

  const voterNames = Object.keys(votes);
  const validVoters = db.getVoters();
  
  // Validate all voter names
  const invalidVoters = voterNames.filter(name => !validVoters.includes(name));
  if (invalidVoters.length > 0) {
    return res.status(400).json({ error: `Invalid voters: ${invalidVoters.join(', ')}` });
  }

  // Validate all votes
  const validVotes = ['yes', 'no'];
  const invalidVotes = Object.values(votes).filter(vote => !validVotes.includes(vote));
  if (invalidVotes.length > 0) {
    return res.status(400).json({ error: 'Invalid vote values. Must be "yes" or "no"' });
  }

  // Submit all votes
  let votesSubmitted = 0;
  let hasError = false;

  voterNames.forEach(voterName => {
    const vote = votes[voterName];
    
    db.submitVote(mediaId, voterName, vote, (err) => {
      if (err && !hasError) {
        hasError = true;
        console.error('Error submitting vote:', err);
        return res.status(500).json({ error: 'Failed to submit votes' });
      }

      votesSubmitted++;
      
      if (votesSubmitted === voterNames.length && !hasError) {
        // Check if all voters voted to delete (no)
        db.checkAllVotesDelete(mediaId, (err, allVotedDelete) => {
          if (err) {
            console.error('Error checking votes:', err);
            return res.json({ success: true });
          }

          if (allVotedDelete) {
            // All voters voted to delete, approve and delete from Sonarr/Radarr
            db.approveMedia(mediaId, (err) => {
              if (err) {
                console.error('Error approving media:', err);
              }
            });

            // Get media details for deletion
            db.db.get('SELECT * FROM media WHERE id = ?', [mediaId], (err, media) => {
              if (!err && media) {
                const { radarrClient, sonarrClient } = getClients();
                deleteFromSonarrRadarr(media, radarrClient, sonarrClient);
              }
            });
          }

          res.json({ success: true, approved: allVotedDelete });
        });
      }
    });
  });
});

// Get votes for specific media
router.get('/media/:id/votes', (req, res) => {
  const mediaId = req.params.id;
  
  db.getMediaVotes(mediaId, (err, votes) => {
    if (err) {
      console.error('Error fetching votes:', err);
      return res.status(500).json({ error: 'Failed to fetch votes' });
    }
    
    res.json(votes);
  });
});

// Get list of voters
router.get('/voters', (req, res) => {
  res.json({ voters: db.getVoters() });
});

// Resync all media from Sonarr/Radarr
router.post('/resync', async (req, res) => {
  try {
    const { radarrClient, sonarrClient } = getClients();
    
    const results = {
      movies: { added: 0, updated: 0, deleted: 0, errors: 0 },
      series: { added: 0, updated: 0, deleted: 0, errors: 0 }
    };

    // Fetch all current external IDs from database
    const currentMediaIds = await new Promise((resolve, reject) => {
      db.db.all('SELECT external_id, type FROM media WHERE status = "pending"', (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    const currentMovieIds = new Set(currentMediaIds.filter(m => m.type === 'movie').map(m => m.external_id));
    const currentSeriesIds = new Set(currentMediaIds.filter(m => m.type === 'series').map(m => m.external_id));

    // Fetch movies from Radarr
    const radarrMovieIds = new Set();
    try {
      const movies = await radarrClient.listMovies();
      for (const movie of movies) {
        radarrMovieIds.add(movie.id);
        try {
          const downloaded = movie.hasFile || false;
          const wasAdded = await new Promise((resolve, reject) => {
            const isExisting = currentMovieIds.has(movie.id);
            db.addMedia(
              movie.id,
              movie.title,
              'movie',
              movie.year,
              movie.overview || '',
              Database.getBestImageUrl(movie.images),
              movie.titleSlug,
              downloaded,
              (err, id) => {
                if (err) {
                  reject(err);
                } else {
                  resolve(!isExisting); // true if it was added, false if updated
                }
              }
            );
          });
          if (wasAdded) {
            results.movies.added++;
          } else {
            results.movies.updated++;
          }
        } catch (error) {
          console.error(`Error adding/updating movie ${movie.title}:`, error);
          results.movies.errors++;
        }
      }
    } catch (error) {
      console.error('Error fetching movies from Radarr:', error.message);
      return res.status(500).json({ error: 'Failed to fetch movies from Radarr' });
    }

    // Fetch series from Sonarr
    const sonarrSeriesIds = new Set();
    try {
      const seriesList = await sonarrClient.listSeries();

      for (const series of seriesList) {
        sonarrSeriesIds.add(series.id);
        try {
          const downloaded = series.statistics?.percentOfEpisodes === 100 || false;
          const wasAdded = await new Promise((resolve, reject) => {
            const isExisting = currentSeriesIds.has(series.id);
            db.addMedia(
              series.id,
              series.title,
              'series',
              series.year,
              series.overview || '',
              Database.getBestImageUrl(series.images),
              series.titleSlug,
              downloaded,
              (err, id) => {
                if (err) {
                  reject(err);
                } else {
                  resolve(!isExisting); // true if it was added, false if updated
                }
              }
            );
          });
          if (wasAdded) {
            results.series.added++;
          } else {
            results.series.updated++;
          }
        } catch (error) {
          console.error(`Error adding/updating series ${series.title}:`, error);
          results.series.errors++;
        }
      }
    } catch (error) {
      console.error('Error fetching series from Sonarr:', error.message);
      return res.status(500).json({ error: 'Failed to fetch series from Sonarr' });
    }

    // Delete movies that no longer exist in Radarr
    const moviesToDelete = [...currentMovieIds].filter(id => !radarrMovieIds.has(id));
    for (const movieId of moviesToDelete) {
      try {
        // Delete votes first (foreign key constraint)
        await new Promise((resolve, reject) => {
          db.db.run('DELETE FROM votes WHERE media_id IN (SELECT id FROM media WHERE external_id = ? AND type = "movie")', [movieId], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        
        // Then delete media
        await new Promise((resolve, reject) => {
          db.db.run('DELETE FROM media WHERE external_id = ? AND type = "movie"', [movieId], function(err) {
            if (err) reject(err);
            else {
              results.movies.deleted += this.changes;
              resolve();
            }
          });
        });
      } catch (error) {
        console.error(`Error deleting movie ${movieId}:`, error);
        results.movies.errors++;
      }
    }

    // Delete series that no longer exist in Sonarr
    const seriesToDelete = [...currentSeriesIds].filter(id => !sonarrSeriesIds.has(id));
    for (const seriesId of seriesToDelete) {
      try {
        // Delete votes first (foreign key constraint)
        await new Promise((resolve, reject) => {
          db.db.run('DELETE FROM votes WHERE media_id IN (SELECT id FROM media WHERE external_id = ? AND type = "series")', [seriesId], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        
        // Then delete media
        await new Promise((resolve, reject) => {
          db.db.run('DELETE FROM media WHERE external_id = ? AND type = "series"', [seriesId], function(err) {
            if (err) reject(err);
            else {
              results.series.deleted += this.changes;
              resolve();
            }
          });
        });
      } catch (error) {
        console.error(`Error deleting series ${seriesId}:`, error);
        results.series.errors++;
      }
    }

    const totalAdded = results.movies.added + results.series.added;
    const totalUpdated = results.movies.updated + results.series.updated;
    const totalDeleted = results.movies.deleted + results.series.deleted;
    
    console.log(`✅ Full resync completed: ${totalAdded} added, ${totalUpdated} updated, ${totalDeleted} deleted`);
    res.json({
      success: true,
      results: {
        movies: results.movies,
        series: results.series,
        totals: {
          added: totalAdded,
          updated: totalUpdated,
          deleted: totalDeleted,
          errors: results.movies.errors + results.series.errors
        }
      }
    });

  } catch (error) {
    console.error('Resync error:', error);
    res.status(500).json({ error: 'Failed to resync' });
  }
});

// Get configuration for frontend
router.get('/config', (req, res) => {
  const appConfig = settingsService.get();
  res.json({
    sonarr: { url: appConfig.sonarr.url },
    radarr: { url: appConfig.radarr.url }
  });
});

// Delete from Sonarr/Radarr
async function deleteFromSonarrRadarr(media, radarrClient, sonarrClient) {
  try {
    if (media.type === 'movie') {
      await radarrClient.deleteMovie(media.external_id);
      console.log(`Successfully deleted movie ${media.title} from Radarr`);
    } else {
      await sonarrClient.deleteSeries(media.external_id);
      console.log(`Successfully deleted series ${media.title} from Sonarr`);
    }
  } catch (error) {
    console.error(`Error deleting ${media.title}:`, error.message);
  }
}

module.exports = router;