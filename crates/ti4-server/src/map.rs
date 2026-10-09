//! Game creation with a start preset; templates and the board geometry are in `ti4-view`.

use ti4_content::ContentStore;
use ti4_content::galaxy::Galaxy;
use ti4_model::id::PlayerId;
use ti4_model::state::GameState;

pub use ti4_view::map::{
    GalaxyLayout, GalaxyPlacement, build_board_tiles, create_game_with_map,
    create_game_with_template,
};

/// As [`create_game_with_template`], then applies the named start preset (if any) to the opening
/// state. Without a preset the result is exactly [`create_game_with_template`]'s.
///
/// # Errors
/// Anything [`create_game_with_template`] reports, or an unknown or unplaceable preset.
pub fn create_game_with_preset(
    content: &ContentStore,
    player_ids: &[PlayerId],
    seed: u64,
    template: Option<&str>,
    preset: Option<&str>,
) -> Result<(GameState, Galaxy), String> {
    let (mut state, galaxy) = create_game_with_template(content, player_ids, seed, template)?;
    if let Some(preset) = preset {
        crate::preset::apply(content, &mut state, &galaxy, player_ids, seed, preset)?;
    }
    Ok((state, galaxy))
}
