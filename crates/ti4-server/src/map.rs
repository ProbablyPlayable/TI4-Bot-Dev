//! Game creation from map templates and presets; the board geometry itself is in `ti4-view`.

use ti4_content::ContentStore;
use ti4_content::galaxy::Galaxy;
use ti4_engine::seating;
use ti4_engine::setup::start_game_seeded;
use ti4_model::content_types::POK;
use ti4_model::id::{PlayerId, SystemId};
use ti4_model::state::GameState;

pub use ti4_view::map::{GalaxyLayout, GalaxyPlacement, build_board_tiles, create_game_with_map};

/// Like [`create_game_with_map`], but lays the board out from the predefined map template
/// `template` when one is named; `None` keeps the seeded random-filler board.
///
/// # Errors
///
/// A message for an unknown template, a seat-count mismatch, or any seating/galaxy failure.
pub fn create_game_with_template(
    content: &ContentStore,
    player_ids: &[PlayerId],
    seed: u64,
    template: Option<&str>,
) -> Result<(GameState, Galaxy), String> {
    let Some(alias) = template else {
        return create_game_with_map(content, player_ids, seed).map_err(|e| e.to_string());
    };
    let loader = crate::maps::TemplateLoader::load()?;
    let template = loader
        .get(alias)
        .ok_or_else(|| crate::maps::TemplateError::Unknown(alias.to_owned()).to_string())?;

    let mut state =
        start_game_seeded(content, player_ids, POK, None, seed).map_err(|e| e.to_string())?;
    let assignments = seating::seat_in_scope(player_ids);
    for (player, faction) in &assignments {
        seating::deploy(&mut state, content, player, faction, POK).map_err(|e| e.to_string())?;
    }
    let homes: Vec<SystemId> = player_ids
        .iter()
        .map(|player| {
            let one =
                std::collections::BTreeMap::from([(player.clone(), assignments[player].clone())]);
            seating::home_systems(content, &one).map(|mut homes| homes.remove(0))
        })
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    let galaxy = crate::maps::build_template_galaxy(content, template, &homes, seed, POK)
        .map_err(|e| e.to_string())?;
    Ok((state, galaxy))
}

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

#[cfg(test)]
mod template_tests {
    use super::*;

    fn players(n: usize) -> Vec<PlayerId> {
        (1..=n).map(|i| PlayerId::new(format!("p{i}"))).collect()
    }

    #[test]
    fn an_unknown_template_is_an_error() {
        let err = create_game_with_template(ContentStore::embedded(), &players(6), 1, Some("nope"))
            .unwrap_err();
        assert!(err.contains("unknown map template"), "{err}");
    }

    #[test]
    fn no_template_keeps_the_random_board() {
        let content = ContentStore::embedded();
        let (_, a) = create_game_with_template(content, &players(6), 9, None).unwrap();
        let (_, b) = create_game_with_map(content, &players(6), 9).unwrap();
        assert_eq!(
            build_board_tiles(content, &a),
            build_board_tiles(content, &b)
        );
    }

    #[test]
    fn a_template_game_seats_every_player_on_their_home() {
        let content = ContentStore::embedded();
        let (state, galaxy) =
            create_game_with_template(content, &players(6), 4, Some("6pStandard")).unwrap();
        assert_eq!(state.players.len(), 6);
        assert!(galaxy.coord_of("18").is_some());
        let (_, random) = create_game_with_map(content, &players(6), 4).unwrap();
        assert_eq!(
            build_board_tiles(content, &galaxy).len(),
            build_board_tiles(content, &random).len()
        );
    }
}
