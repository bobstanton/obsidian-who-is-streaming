# Who Is Streaming

Discover and document which streaming services a movie is currently available to be streamed on using the [Streaming Availability API](https://www.movieofthenight.com/about/api) by [Movie of the Night](https://www.movieofthenight.com/). Details about the movie and streaming status will be added as properties to your [Obsidian](https://obsidian.md) note.


## Usage

An [API Key](https://rapidapi.com/movie-of-the-night-movie-of-the-night-default/api/streaming-availability/pricing) for the Streaming Availability API is required. After signing up for an API Key, enter the key into the settings page, choose your country and select which streaming services you are interested in.

Then create a new note, enter a movie or TV show as the name of the note, then use the popcorn ribbon button or `Search` command. The title of the note will be used to search the Streaming Availability API. A list of options will be presented to choose from. After syncing a note once, the `Refresh` command can use the `tmdb_id` and `Type` properties to sync directly without the need for a search.


## Cost

The [Streaming Availability API](https://rapidapi.com/movie-of-the-night-movie-of-the-night-default/api/streaming-availability/pricing) offers free and paid tiers.


## Demo

https://github.com/user-attachments/assets/ab89ea54-b529-49e0-aa6a-15a6ee7679ca


## Network Requests

This plugin makes the following network requests:

| Package | URL | Purpose |
| ------- | --- | ------- |
| `streaming-availability` | Streaming Availability API by Movie of the Night | Search movies and TV shows, fetch availability by TMDB ID, and load supported countries. |
| Who Is Streaming | User-configured Jellyfin server URL | Search Jellyfin libraries for matching shows and read watched status. |
| Who Is Streaming | Poster image URLs returned by the Streaming Availability API | Download poster images into the vault when local poster saving is enabled. |


## Dependencies

| Package                                                                        | Description                                                  |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| [streaming-availability](https://www.npmjs.com/package/streaming-availability) | Calls the Streaming Availability API by Movie of the Night   |
| [he](https://github.com/mathiasbynens/he)                                      | Decodes HTML entities in movie and show metadata             |
| [Dataview](https://blacksmithgu.github.io/obsidian-dataview/)                  | Optional. Used for bulk refresh features                     |

