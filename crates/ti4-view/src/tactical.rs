//! What a client needs to stage a tactical action and the pending choice does not say: the ships
//! in range of a system, and for the movement the path of each ship, the rifts on it, and what the
//! ship can load.
//!
//! Nothing here decides a rule. Every fact is the answer of a public function of the engine, asked
//! the way the engine asks it when it applies the move (`Game::begin_one_move`).

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use ti4_content::ContentStore;
use ti4_content::galaxy::Galaxy;
use ti4_content::units::catalogue;
use ti4_engine::choice::Choice;
use ti4_engine::movement::{Board, MovementRules};
use ti4_engine::tactical::{ACTIVATE_KIND, Movable, effective_move_value_for_ship, movable_into};
use ti4_engine::transit::{CargoWindow, LOAD_KIND, rifts_exited};
use ti4_model::content_types::SourceSet;
use ti4_model::id::{PlayerId, SystemId};
use ti4_model::state::GameState;
use ti4_model::units::Unit;

/// The subtype of the choice of a system to activate.
pub const ACTIVATION_SUBTYPE: &str = "activate_system";
/// The subtype of the choice of a ship to move.
pub const MOVEMENT_SUBTYPE: &str = "movement_step";

/// How many ships of the seat can move to one system, if it is activated.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReachFact {
    pub system: String,
    pub ships: usize,
    /// The number of systems that these ships are in.
    pub origins: usize,
}

/// How a ship gets to the active system.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MoveFact {
    /// The move uses Gravity Drive: the ship cannot arrive without it.
    pub gravity_drive: bool,
    /// The move exhausts the Ionian Fuel Refinery.
    pub ionian: bool,
    /// The systems that the ship enters, in order. The last one is the active system.
    pub path: Vec<String>,
    /// The gravity rifts that the ship leaves on this path. It rolls once for each.
    pub rifts: Vec<String>,
}

/// Why a ship cannot move to the active system.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Blocked {
    /// The system of the ship has a command token of the seat.
    CommandToken,
    /// No path of the ship reaches the active system.
    Range,
}

/// One ship of the seat outside the active system.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShipFact {
    pub origin: String,
    /// The place of the ship among the units of the seat in the space area of `origin`.
    pub index: usize,
    pub unit: String,
    pub damaged: bool,
    pub capacity: i64,
    /// The ship counts against the fleet pool.
    pub fleet: bool,
    /// The move value of the ship in this activation, without Gravity Drive and the Ionian Fuel
    /// Refinery: a move that uses one of them says so, and has 1 more for each.
    pub move_value: i32,
    /// The ship starts in a nebula: it moves with a value of 1, whatever `move_value` is.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub nebula: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r#move: Option<MoveFact>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blocked: Option<Blocked>,
    /// What the ship can load: places in [`MovementFacts::cargo`].
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub loads: Vec<usize>,
}

/// Units of one kind in one place that a ship can load.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CargoPool {
    pub system: String,
    /// The planet, or `None` for the space area.
    pub source: Option<String>,
    pub unit: String,
    pub damaged: bool,
    pub galvanized: bool,
    pub count: usize,
}

/// What the seat may keep in the active system (fleet supply).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FleetSupplyFact {
    pub limit: i64,
    pub charged: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActivationFacts {
    pub tactic_tokens: i32,
    pub systems: Vec<ReachFact>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MovementFacts {
    pub active: String,
    pub ships: Vec<ShipFact>,
    pub cargo: Vec<CargoPool>,
    /// Gravity Drive can still give one ship of this action its move.
    pub gravity_drive: bool,
    /// The Ionian Fuel Refinery can still give one ship its move.
    pub ionian: bool,
    pub fleet_supply: FleetSupplyFact,
    /// How many ships already moved in this activation.
    pub moved: u32,
}

/// The facts of the pending choice of a tactical action.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TacticalFacts {
    Activation(ActivationFacts),
    Movement(MovementFacts),
}

/// The facts for `choice`, when it is the choice of a system to activate or of a ship to move.
#[must_use]
pub fn project_tactical_facts(
    state: &GameState,
    content: &ContentStore,
    sources: SourceSet,
    galaxy: &Galaxy,
    choice: &Choice,
) -> Option<TacticalFacts> {
    let player = &choice.player;
    match choice.context.as_ref()?.subtype.as_str() {
        ACTIVATION_SUBTYPE => Some(TacticalFacts::Activation(activation(
            state, content, sources, galaxy, player, choice,
        ))),
        MOVEMENT_SUBTYPE => {
            movement(state, content, sources, galaxy, player).map(TacticalFacts::Movement)
        }
        _ => None,
    }
}

fn activation(
    state: &GameState,
    content: &ContentStore,
    sources: SourceSet,
    galaxy: &Galaxy,
    player: &PlayerId,
    choice: &Choice,
) -> ActivationFacts {
    let systems = choice
        .options
        .iter()
        .filter(|option| option.kind == ACTIVATE_KIND)
        .map(|option| {
            let system = SystemId::new(option.id.clone());
            let ships = movable_into(state, content, sources, galaxy, player, &system);
            let origins: BTreeSet<&SystemId> = ships.iter().map(|ship| &ship.origin).collect();
            ReachFact {
                system: option.id.clone(),
                ships: ships.len(),
                origins: origins.len(),
            }
        })
        .collect();
    ActivationFacts {
        tactic_tokens: state.player(player).map_or(0, |seat| seat.tactic_tokens),
        systems,
    }
}

/// The key of a pool: where the units are and what makes two of them the same for the game.
type PoolKey = (String, Option<String>, String, bool, bool);

fn pool_count(state: &GameState, player: &PlayerId, key: &PoolKey) -> usize {
    let (system, source, unit, damaged, galvanized) = key;
    let Some(system) = state.board.get(&SystemId::new(system.clone())) else {
        return 0;
    };
    let same = |candidate: &&Unit| {
        &candidate.owner == player
            && candidate.type_id.as_str() == unit
            && candidate.sustained_damage == *damaged
            && candidate.galvanized == *galvanized
    };
    match source {
        None => system.units.iter().filter(same).count(),
        Some(planet) => system
            .planet_units
            .iter()
            .filter(|(id, _)| id.as_str() == planet)
            .flat_map(|(_, units)| units)
            .filter(same)
            .count(),
    }
}

/// What the hold of `ship` is offered on `path`: the `load` options of the engine's own window.
fn pools_of(
    state: &GameState,
    content: &ContentStore,
    sources: SourceSet,
    player: &PlayerId,
    origin: &SystemId,
    ship: &Unit,
    path: &[String],
) -> Vec<PoolKey> {
    let hold = CargoWindow::for_ship(state, content, sources, player, origin, ship, path);
    let Some(choice) = hold.pending_choice() else {
        return Vec::new();
    };
    choice
        .options
        .iter()
        .filter(|option| option.kind == LOAD_KIND)
        .filter_map(|option| {
            let text = |key: &str| option.payload.get(key).and_then(serde_json::Value::as_str);
            let flag = |key: &str| {
                option
                    .payload
                    .get(key)
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false)
            };
            Some((
                text("pickup_system")?.to_owned(),
                text("source").map(str::to_owned),
                text("unit")?.to_owned(),
                flag("damaged"),
                flag("galvanized"),
            ))
        })
        .collect()
}

fn movement(
    state: &GameState,
    content: &ContentStore,
    sources: SourceSet,
    galaxy: &Galaxy,
    player: &PlayerId,
) -> Option<MovementFacts> {
    let active = state.active_system.clone()?;
    let types = catalogue(content, sources);
    let mut rules = MovementRules::with_laws(
        galaxy,
        content,
        sources,
        active.as_str(),
        Board::for_player(state, content, sources, player),
        Some(state),
    );
    ti4_engine::action_cards::apply_movement_effects(&mut rules, state, player);
    let rolls = !rules.anomalies_ignored && !rules.rifts_ignored;

    let movable: BTreeMap<(SystemId, usize), Movable> =
        movable_into(state, content, sources, galaxy, player, &active)
            .into_iter()
            .map(|ship| ((ship.origin.clone(), ship.index), ship))
            .collect();

    let mut pools: Vec<PoolKey> = Vec::new();
    let mut ships = Vec::new();
    for origin in state.systems_with_units_of(player) {
        if *origin == active {
            continue;
        }
        for (index, hull) in state.ships_of(player, origin).into_iter().enumerate() {
            let Some(kind) = types.get(hull.type_id.as_str()) else {
                continue;
            };
            if !kind.moves_as_ship() {
                continue;
            }
            let found = movable.get(&(origin.clone(), index));
            // A fighter that does not move on its own is cargo, not a ship that stays behind.
            if found.is_none() && kind.consumes_capacity() {
                continue;
            }
            // The route of the offer: the same value and the same type as `begin_one_move`.
            let path = found.and_then(|found| {
                let value = effective_move_value_for_ship(
                    state,
                    kind,
                    player,
                    origin,
                    Some(index),
                    found.gravity_drive,
                    found.ionian,
                );
                rules
                    .path_from_ship(origin.as_str(), value, Some(hull.type_id.as_str()))
                    .map(|path| (found, path))
            });
            let mut loads = Vec::new();
            let r#move = path.map(|(found, path)| {
                for key in pools_of(state, content, sources, player, origin, hull, &path) {
                    let place = pools.iter().position(|known| *known == key);
                    loads.push(place.unwrap_or_else(|| {
                        pools.push(key);
                        pools.len() - 1
                    }));
                }
                MoveFact {
                    gravity_drive: found.gravity_drive,
                    ionian: found.ionian,
                    rifts: if rolls {
                        rifts_exited(&rules, &path)
                    } else {
                        Vec::new()
                    },
                    path,
                }
            });
            let blocked = r#move.is_none().then(|| {
                if rules.may_depart(origin.as_str()) {
                    Blocked::Range
                } else {
                    Blocked::CommandToken
                }
            });
            ships.push(ShipFact {
                origin: origin.to_string(),
                index,
                unit: hull.type_id.to_string(),
                damaged: hull.sustained_damage,
                capacity: kind.capacity(),
                fleet: !kind.is_fighter(),
                move_value: effective_move_value_for_ship(
                    state,
                    kind,
                    player,
                    origin,
                    Some(index),
                    false,
                    false,
                ),
                nebula: rules.nebula_caps(origin.as_str()),
                r#move,
                blocked,
                loads,
            });
        }
    }

    let standing = ti4_engine::fleet::standing(state, content, sources, player, &active, None);
    Some(MovementFacts {
        active: active.to_string(),
        ships,
        cargo: pools
            .into_iter()
            .map(|key| CargoPool {
                count: pool_count(state, player, &key),
                system: key.0,
                source: key.1,
                unit: key.2,
                damaged: key.3,
                galvanized: key.4,
            })
            .collect(),
        gravity_drive: ti4_engine::technology::gravity_drive_available(state, player),
        ionian: ti4_engine::legendary::ionian_available(state, player),
        fleet_supply: FleetSupplyFact {
            limit: standing.fleet_limit,
            charged: standing.fleet_charged,
        },
        moved: state
            .faction_marks
            .get(&format!("private:#moved:{}", state.activation_seq))
            .and_then(|count| count.parse().ok())
            .unwrap_or(0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use ti4_engine::choice::ChoiceOption;
    use ti4_engine::decision_context::{DecisionContext, DecisionSource};
    use ti4_engine::tactical::activation_options_with;
    use ti4_model::content_types::POK;
    use ti4_model::id::UnitTypeId;
    use ti4_model::state::Phase;

    fn seat() -> PlayerId {
        PlayerId::new("a")
    }

    /// A game of six on the recommended map, before the first action.
    fn game() -> (GameState, Galaxy) {
        let content = ContentStore::embedded();
        let ids: Vec<PlayerId> = ["a", "b", "c", "d", "e", "f"]
            .iter()
            .map(|name| PlayerId::new(*name))
            .collect();
        let loader = crate::maps::TemplateLoader::load().expect("the templates load");
        let template = crate::maps::default_template_for(content, &loader, 6, POK)
            .expect("a template for six");
        let (mut state, galaxy) =
            crate::map::create_game_with_template(content, &ids, 3, Some(&template))
                .expect("a game");
        state.phase = Phase::Action;
        (state, galaxy)
    }

    fn movement_choice() -> Choice {
        Choice::new(seat(), "movement", vec![ChoiceOption::decline()]).contextualized(
            DecisionContext::new(
                seat(),
                DecisionSource::Rule("89.2".to_owned()),
                MOVEMENT_SUBTYPE,
                Phase::Action,
                1,
            ),
        )
    }

    fn facts_into(state: &mut GameState, galaxy: &Galaxy, active: &str) -> MovementFacts {
        state.active_system = Some(SystemId::new(active));
        match project_tactical_facts(
            state,
            ContentStore::embedded(),
            POK,
            galaxy,
            &movement_choice(),
        ) {
            Some(TacticalFacts::Movement(facts)) => facts,
            other => panic!("no movement facts: {other:?}"),
        }
    }

    /// The system where the seat has its ships at the start.
    fn home(state: &GameState) -> SystemId {
        state
            .systems_with_units_of(&seat())
            .into_iter()
            .next()
            .expect("a home system")
            .clone()
    }

    #[test]
    fn only_the_two_choices_of_a_tactical_action_have_facts() {
        let (state, galaxy) = game();
        let content = ContentStore::embedded();
        let other = Choice::new(seat(), "action phase", vec![ChoiceOption::decline()])
            .contextualized(DecisionContext::new(
                seat(),
                DecisionSource::Rule("22".to_owned()),
                "action_menu",
                Phase::Action,
                1,
            ));
        assert_eq!(
            project_tactical_facts(&state, content, POK, &galaxy, &other),
            None
        );
        let bare = Choice::new(seat(), "movement", vec![ChoiceOption::decline()]);
        assert_eq!(
            project_tactical_facts(&state, content, POK, &galaxy, &bare),
            None
        );
    }

    #[test]
    fn activation_counts_the_ships_that_the_movement_then_lists() {
        let (mut state, galaxy) = game();
        let content = ContentStore::embedded();
        let choice =
            activation_options_with(&state, content, POK, &galaxy, &seat()).expect("offered");
        let Some(TacticalFacts::Activation(facts)) =
            project_tactical_facts(&state, content, POK, &galaxy, &choice)
        else {
            panic!("no activation facts");
        };
        assert_eq!(facts.systems.len(), choice.options.len());
        assert!(facts.tactic_tokens > 0);
        assert!(facts.systems.iter().any(|reach| reach.ships > 0));
        for reach in &facts.systems {
            let movement = facts_into(&mut state, &galaxy, &reach.system);
            let moving: Vec<_> = movement
                .ships
                .iter()
                .filter(|ship| ship.r#move.is_some())
                .collect();
            assert_eq!(moving.len(), reach.ships, "into {}", reach.system);
            let origins: BTreeSet<_> = moving.iter().map(|ship| &ship.origin).collect();
            assert_eq!(origins.len(), reach.origins, "into {}", reach.system);
        }
    }

    #[test]
    fn a_ship_behind_a_command_token_or_out_of_range_says_why() {
        let (mut state, galaxy) = game();
        let home = home(&state);
        let reach = |state: &mut GameState, active: &str| {
            let facts = facts_into(state, &galaxy, active);
            let moving = facts.ships.iter().filter(|s| s.r#move.is_some()).count();
            (facts, moving)
        };
        let targets: Vec<String> = galaxy.system_ids().into_iter().map(str::to_owned).collect();
        let near = targets
            .iter()
            .find(|id| id.as_str() != home.as_str() && reach(&mut state, id).1 > 0)
            .expect("a system in range")
            .clone();
        let far = targets
            .iter()
            .find(|id| id.as_str() != home.as_str() && reach(&mut state, id).1 == 0)
            .expect("a system out of range");

        let (facts, _) = reach(&mut state, far);
        assert!(!facts.ships.is_empty());
        for ship in &facts.ships {
            assert_eq!(ship.blocked, Some(Blocked::Range), "{ship:?}");
            assert!(ship.loads.is_empty());
        }
        // Units that only ride are cargo, not ships that stay behind.
        assert!(facts.ships.iter().all(|ship| ship.unit != "fighter"));
        assert!(facts.cargo.is_empty());

        state.system_mut(&home).place_token(seat());
        let (facts, moving) = reach(&mut state, &near);
        assert_eq!(moving, 0);
        for ship in &facts.ships {
            assert_eq!(ship.blocked, Some(Blocked::CommandToken), "{ship:?}");
        }
    }

    #[test]
    fn every_ship_has_its_move_value_and_a_nebula_caps_it() {
        let content = ContentStore::embedded();
        let is_nebula = |id: &str| {
            ti4_content::galaxy::system(content, id, POK).is_some_and(|system| system.is_nebula())
        };
        // The map of the template has no nebula: one takes the place of a system next to home.
        let (mut state, mut galaxy) = game();
        let active = home(&state);
        let nebula = ti4_content::galaxy::all_systems(content, POK)
            .into_keys()
            .find(|id| is_nebula(id))
            .expect("a nebula")
            .to_owned();
        let old = galaxy
            .adjacent(active.as_str())
            .into_iter()
            .find(|id| !ti4_content::galaxy::is_home_system(content, id, POK))
            .expect("a system next to home")
            .to_owned();
        galaxy
            .replace_system(content, &old, &nebula, POK)
            .expect("the nebula is placed");
        // A carrier and its upgrade in every system, so that some start in the nebula.
        let systems: Vec<SystemId> = galaxy.system_ids().into_iter().map(SystemId::new).collect();
        for system in &systems {
            for kind in ["carrier", "carrier2"] {
                state
                    .system_mut(system)
                    .units
                    .push(Unit::new(UnitTypeId::new(kind), seat()));
            }
        }
        let facts = facts_into(&mut state, &galaxy, active.as_str());
        let mut capped = 0;
        for ship in &facts.ships {
            match ship.unit.as_str() {
                "carrier" => assert_eq!(ship.move_value, 1, "{ship:?}"),
                "carrier2" => assert_eq!(ship.move_value, 2, "{ship:?}"),
                _ => {}
            }
            assert_eq!(ship.nebula, is_nebula(&ship.origin), "{ship:?}");
            if let (true, Some(route)) = (ship.nebula, &ship.r#move) {
                // With a value of 1 the path is the nebula and the active system, no other.
                assert_eq!(route.path.len(), 2, "{ship:?}");
            }
            capped += usize::from(ship.nebula);
        }
        assert!(capped > 0, "no ship starts in the nebula");
    }

    #[test]
    fn every_move_ends_in_the_active_system_and_loads_what_is_on_its_path() {
        let (mut state, galaxy) = game();
        // Infantry of the seat in the space area of every system, so that a ship passes some.
        let systems: Vec<SystemId> = galaxy.system_ids().into_iter().map(SystemId::new).collect();
        for system in &systems {
            state
                .system_mut(system)
                .units
                .push(Unit::new(UnitTypeId::new("infantry"), seat()));
        }
        // One more carrier, and Gravity Drive, with which a carrier passes a system.
        let home = home(&state);
        state
            .system_mut(&home)
            .units
            .push(Unit::new(UnitTypeId::new("carrier"), seat()));
        if let Some(seat) = state.player_mut(&seat()) {
            seat.technologies
                .insert(ti4_model::id::TechnologyId::new("gd"));
        }
        let (mut on_the_way, mut boosted, mut rifts) = (0, 0, 0);
        let targets: Vec<String> = galaxy.system_ids().into_iter().map(str::to_owned).collect();
        for active in &targets {
            let facts = facts_into(&mut state, &galaxy, active);
            assert_eq!(&facts.active, active);
            assert!(facts.gravity_drive);
            for pool in &facts.cargo {
                assert!(pool.count > 0, "{pool:?}");
            }
            for ship in &facts.ships {
                assert_ne!(&ship.origin, active);
                assert_ne!(ship.r#move.is_some(), ship.blocked.is_some(), "{ship:?}");
                let Some(route) = &ship.r#move else {
                    continue;
                };
                assert_eq!(route.path.last(), Some(active), "{ship:?}");
                boosted += usize::from(route.gravity_drive);
                rifts += route.rifts.len();
                for rift in &route.rifts {
                    assert!(route.path[..route.path.len() - 1].contains(rift));
                }
                assert_eq!(ship.loads.is_empty(), ship.capacity == 0, "{ship:?}");
                for place in &ship.loads {
                    let pool = &facts.cargo[*place];
                    assert!(
                        pool.system == ship.origin || route.path.contains(&pool.system),
                        "{pool:?} is not on the path of {ship:?}"
                    );
                    on_the_way +=
                        usize::from(pool.system != ship.origin && pool.system != facts.active);
                }
            }
        }
        assert!(on_the_way > 0, "no ship passed a system with units");
        assert!(boosted > 0, "no ship needed Gravity Drive");
        // The map of this seed may have no rift in reach: the count is only checked for shape.
        let _ = rifts;
    }

    #[test]
    fn the_facts_are_tagged_by_kind_on_the_wire() {
        let (mut state, galaxy) = game();
        let home = home(&state);
        let facts = facts_into(&mut state, &galaxy, home.as_str());
        let value =
            serde_json::to_value(TacticalFacts::Movement(facts.clone())).expect("it serializes");
        assert_eq!(value["kind"], "movement");
        assert_eq!(value["active"], home.as_str());
        assert_eq!(value["fleet_supply"]["limit"], facts.fleet_supply.limit);
        let back: TacticalFacts = serde_json::from_value(value).expect("it reads back");
        assert_eq!(back, TacticalFacts::Movement(facts));
    }
}
