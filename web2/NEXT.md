Also look for UX ideas on how to integrate this: in web/, and in the demo of web2 (`?example=…`, the code in `web2/src/mock/`), which shows screens that are not wired to the engine yet.

- state should be inspectable and wired up next (exhausted planets with dotted ring instead of solid, objectives, technology, cards, ...)
- payment is also painful and should be done via the map (like the demo of web2, `?example=draft-production`)
- map space combat view should be similar to web/
- everywhere a system name is used (e.g. move summary, later event log, ...): on desktop hover should highlight, click should be like click on the system on the map. on mobile map view is opened with system selected. The same with planets.
- we should also show the command tokens of other players that activate systems (we need to test the UI how to do this for a system where 8 players have activated it)
- for testing we need some useful starting points / scenarios from real games we can just load. look at web/ for scenario ideas. We do not need all. As of now we only wired movement, so we should be able to test all kind of edge cases with a few scenarios. (gravity drive, multiple systems, ship techs which improve movement range)