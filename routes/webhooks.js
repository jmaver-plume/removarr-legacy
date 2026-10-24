const express = require('express');
const Database = require('../database/db');
const router = express.Router();

const db = new Database();

// Sonarr webhook endpoint
router.post('/sonarr', (req, res) => {
  const payload = req.body;
  
  console.log('Sonarr webhook received:', payload.eventType);
  
  switch (payload.eventType) {
    case 'Download':
      handleSeriesDownloaded(payload);
      break;
    case 'SeriesAdd':
      handleSeriesAdded(payload);
      break;
    case 'SeriesDelete':
      handleSeriesDeleted(payload);
      break;
    default:
      console.log('Unhandled Sonarr event:', payload.eventType);
  }
  
  res.status(200).json({ success: true });
});

// Radarr webhook endpoint
router.post('/radarr', (req, res) => {
  const payload = req.body;
  
  console.log('Radarr webhook received:', payload.eventType);
  
  switch (payload.eventType) {
    case 'Download':
      handleMovieDownloaded(payload);
      break;
    case 'MovieAdded':
      handleMovieAdded(payload);
      break;
    case 'MovieDelete':
      handleMovieDeleted(payload);
      break;
    default:
      console.log('Unhandled Radarr event:', payload.eventType);
  }
  
  res.status(200).json({ success: true });
});

function handleSeriesAdded(payload) {
  const series = payload.series;
  if (!series) return;
  
  const externalId = series.id;
  const title = series.title;
  const year = series.year;
  const overview = series.overview || '';
  const posterUrl = Database.getBestImageUrl(series.images);
  const titleSlug = series.titleSlug;
  
  db.addMedia(externalId, title, 'series', year, overview, posterUrl, titleSlug, (err, id) => {
    if (err) {
      console.error('Error adding series to database:', err);
    } else {
      console.log(`Added series: ${title} (ID: ${id})`);
    }
  });
}

function handleMovieAdded(payload) {
  const movie = payload.movie;
  if (!movie) return;
  
  const externalId = movie.id;
  const title = movie.title;
  const year = movie.year;
  const overview = movie.overview || '';
  const posterUrl = Database.getBestImageUrl(movie.images);
  const titleSlug = movie.titleSlug;
  
  db.addMedia(externalId, title, 'movie', year, overview, posterUrl, titleSlug, (err, id) => {
    if (err) {
      console.error('Error adding movie to database:', err);
    } else {
      console.log(`Added movie: ${title} (ID: ${id})`);
    }
  });
}

function handleSeriesDeleted(payload) {
  const series = payload.series;
  if (!series) return;
  
  db.removeMedia(series.id, (err, changes) => {
    if (err) {
      console.error('Error removing series from database:', err);
    } else if (changes > 0) {
      console.log(`Removed series: ${series.title}`);
    }
  });
}

function handleMovieDeleted(payload) {
  const movie = payload.movie;
  if (!movie) return;
  
  db.removeMedia(movie.id, (err, changes) => {
    if (err) {
      console.error('Error removing movie from database:', err);
    } else if (changes > 0) {
      console.log(`Removed movie: ${movie.title}`);
    }
  });
}

function handleMovieDownloaded(payload) {
  const movie = payload.movie;
  if (!movie) return;
  
  const externalId = movie.id;
  const downloaded = movie.hasFile || false;
  
  db.updateDownloadStatus(externalId, 'movie', downloaded, (err, changes) => {
    if (err) {
      console.error('Error updating movie download status:', err);
    } else if (changes > 0) {
      console.log(`Updated movie download status: ${movie.title} -> ${downloaded ? 'Downloaded' : 'Not Downloaded'}`);
    }
  });
}

function handleSeriesDownloaded(payload) {
  const series = payload.series;
  if (!series) return;
  
  const externalId = series.id;
  const downloaded = series.statistics?.percentOfEpisodes === 100 || false;
  
  db.updateDownloadStatus(externalId, 'series', downloaded, (err, changes) => {
    if (err) {
      console.error('Error updating series download status:', err);
    } else if (changes > 0) {
      console.log(`Updated series download status: ${series.title} -> ${downloaded ? 'Downloaded' : 'Not Downloaded'}`);
    }
  });
}

module.exports = router;