# Who Is Streaming

Discover and document which streaming services a movie or series is currently available to be streamed on using the [Streaming Availability API](https://www.movieofthenight.com/about/api) by [Movie of the Night](https://www.movieofthenight.com/). Details about the title and its streaming status will be added as properties to your [Obsidian](https://obsidian.md) note.


## Usage

An [API key](https://www.movieofthenight.com/about/api) for the Streaming Availability API is required. After signing up for an API key, enter the key into the settings page, choose your country and select which streaming services you are interested in.

Then create a new note, enter a movie or series as the name of the note, then use the popcorn ribbon button or `Search` command. The name of the note will be used to search the Streaming Availability API. A list of options will be presented to choose from. After a note has been refreshed once, the `Refresh` command can use the `tmdb_id` and `Type` properties to refresh it directly without the need for a search.


## Cost

The [Streaming Availability API](https://www.movieofthenight.com/about/api/pricing) offers free and paid tiers.


## Demo

https://github.com/user-attachments/assets/ab89ea54-b529-49e0-aa6a-15a6ee7679ca


## Styling the Title stats view

The Title stats view can be restyled with a [CSS snippet](https://help.obsidian.md/snippets). Everything is inside `.who-is-streaming-stats`, and the plugin's own rules are written so that a plain one-class rule in a snippet overrides them.

Set these variables on `.who-is-streaming-stats` to change the look without touching individual rules:

| Variable                | What it controls                                      | Default                          |
| ----------------------- | ----------------------------------------------------- | -------------------------------- |
| `--stats-accent`        | Colour of bars, columns and the busiest calendar days | Your theme's accent colour       |
| `--stats-accent-hover`  | Colour of a bar or column under the pointer           | Your theme's accent hover colour |
| `--stats-empty`         | Colour of a calendar day with no watches              | Your theme's border colour       |
| `--stats-gap`           | Space between tiles and between panels                | `12px`                           |
| `--stats-panel-padding` | Padding inside tiles and panels                       | `12px 14px`                      |
| `--stats-panel-radius`  | Corner rounding of tiles and panels                   | Your theme's medium radius       |
| `--stats-bar-height`    | Thickness of horizontal bars                          | `10px`                           |
| `--stats-bar-radius`    | Rounding of bar and column ends                       | `4px`                            |
| `--stats-column-height` | Height of the column charts                           | `170px`                          |
| `--stats-cell-size`     | Size of one day in the activity calendar              | `11px`                           |
| `--stats-cell-gap`      | Space between calendar days                           | `2px`                            |

To style one part of the view, use these attributes:

| Attribute      | On                | Values                                                                                                 |
| -------------- | ----------------- | ------------------------------------------------------------------------------------------------------ |
| `data-panel`   | Each panel        | `matches`, `timeline`, `activity`, `genres`, `cast`, `directors`, `decades`, `ratings`, `availability` |
| `data-tile`    | Each summary tile | `titles`, `watched`, `watches`, `hours`, `streak`, `busy-days`, `average-rating`                       |
| `data-measure` | The view          | `titles`, `watches`, `hours`                                                                           |
| `data-period`  | The view          | `all`, `this-year`, `last-year`, `last-12-months`, `custom`                                            |
| `data-scope`   | The view          | `watched`, `all`                                                                                       |

For example:

```css
/* Green charts, with larger calendar days. */
.who-is-streaming-stats {
  --stats-accent: #2e8b57;
  --stats-accent-hover: #1f6f43;
  --stats-cell-size: 15px;
}

/* Give one panel its own colour, and hide another. */
.who-is-streaming-stats [data-panel="genres"] {
  --stats-accent: #c0392b;
}

.who-is-streaming-stats [data-panel="cast"] {
  display: none;
}
```


## Network Requests

This plugin makes the following network requests:

| Package                  | URL                                                                         | Purpose                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `streaming-availability` | Streaming Availability API by Movie of the Night                            | Search for titles (movies and series), fetch availability by TMDB ID, and load supported countries.                     |
| Who Is Streaming         | User-configured Jellyfin server URL                                         | List the titles in Jellyfin libraries and read watched status and dates.                                                |
| Who Is Streaming         | Poster image URLs returned by the Streaming Availability API                | Download poster images into the vault when local poster saving is enabled.                                              |
| Who Is Streaming         | `api.themoviedb.org` and `image.tmdb.org` (only when a TMDB API key is set) | Identify titles and fetch posters and details. This product uses the TMDB API but is not endorsed or certified by TMDB. |


## Dependencies

| Package                                                                        | Description                                                |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| [streaming-availability](https://www.npmjs.com/package/streaming-availability) | Calls the Streaming Availability API by Movie of the Night |
| [he](https://github.com/mathiasbynens/he)                                      | Decodes HTML entities in title metadata                    |
| [d3-force](https://github.com/d3/d3-force)                                     | Lays out the cast graph view                               |
