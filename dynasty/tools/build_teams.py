"""Builds dynasty/teams.js (every D1 team: ESPN id, name, mascot, color, conference, prestige) from the
ncaab-model team list. Logos load from ESPN's CDN by id. Run again after realignment."""
import csv
import json
import os

SRC = os.path.expanduser("~/Desktop/ncaab-model/data")
OUT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CONF_NAME = {"ACC": "ACC", "Big Ten": "Big Ten", "SEC": "SEC", "Big 12": "Big 12", "Big East": "Big East", "Pac-12": "Pac-12",
             "Mountain West": "Mountain West", "WCC": "West Coast", "A-10": "Atlantic 10", "American": "American", "MVC": "Missouri Valley",
             "CUSA": "Conference USA", "Sun Belt": "Sun Belt", "MAC": "MAC", "CAA": "Coastal", "SoCon": "Southern", "Big West": "Big West",
             "Horizon": "Horizon", "Summit": "Summit", "Big Sky": "Big Sky", "OVC": "Ohio Valley", "UAC": "United Athletic", "Southland": "Southland",
             "SWAC": "SWAC", "MEAC": "MEAC", "NEC": "Northeast", "Metro": "MAAC", "Patriot": "Patriot", "Big South": "Big South",
             "Atlantic Sun": "ASUN", "Am. East": "America East", "Ivy": "Ivy League"}
# where a program starts if it isn't named below
CONF_BASE = {"ACC": 64, "Big Ten": 66, "SEC": 68, "Big 12": 68, "Big East": 64, "Pac-12": 52, "Mountain West": 48, "WCC": 44, "A-10": 48,
             "American": 48, "MVC": 46, "CUSA": 44, "Sun Belt": 42, "MAC": 42, "CAA": 40, "SoCon": 40, "Big West": 40, "Horizon": 39,
             "Summit": 39, "Big Sky": 37, "OVC": 34, "UAC": 35, "Southland": 33, "SWAC": 25, "MEAC": 27, "NEC": 27, "Metro": 36,
             "Patriot": 37, "Big South": 37, "Atlantic Sun": 37, "Am. East": 37, "Ivy": 40}
PRESTIGE = {
    # blue bloods
    "Duke": 99, "Kentucky": 98, "Kansas": 98, "North Carolina": 97, "UConn": 96,
    # elite power programs
    "Houston": 91, "Michigan State": 90, "Arizona": 90, "Gonzaga": 89, "UCLA": 87, "Purdue": 87, "Florida": 87, "Auburn": 86,
    "Tennessee": 86, "Villanova": 85, "Alabama": 85, "Baylor": 84, "Iowa State": 83, "Louisville": 83, "Indiana": 82, "Illinois": 82,
    "Texas Tech": 82, "St. John's": 82, "Arkansas": 82, "Michigan": 82, "Marquette": 81, "Wisconsin": 81, "Creighton": 80, "Syracuse": 80,
    "Texas": 79, "BYU": 78, "Ohio State": 78, "Virginia": 78, "Maryland": 77, "Xavier": 77, "Oregon": 77, "Texas A&M": 77, "Memphis": 74,
    "Mississippi State": 74, "Ole Miss": 74, "Missouri": 73, "Kansas State": 73, "Cincinnati": 73, "LSU": 72, "Oklahoma": 72, "Iowa": 72,
    "Saint Mary's": 72, "San Diego State": 72, "Georgetown": 72, "Providence": 72, "West Virginia": 72, "Butler": 72, "USC": 72,
    "NC State": 72, "Wake Forest": 70, "Clemson": 72, "Pittsburgh": 70, "Notre Dame": 70, "Seton Hall": 70, "Georgia": 70, "TCU": 70,
    "Utah": 68, "Colorado": 68, "Florida State": 70, "Miami": 70, "Nebraska": 66, "Minnesota": 64, "Northwestern": 66, "Penn State": 64,
    "Rutgers": 64, "Washington": 66, "Oklahoma State": 68, "Arizona State": 68, "UCF": 66, "Vanderbilt": 68, "South Carolina": 68,
    "Stanford": 66, "California": 60, "SMU": 64, "Virginia Tech": 64, "Georgia Tech": 62, "Boston College": 58, "DePaul": 56,
    # top mid-majors
    "Dayton": 68, "VCU": 68, "Florida Atlantic": 66, "Utah State": 66, "New Mexico": 64, "Boise State": 63, "Colorado State": 62,
    "Wichita State": 62, "Grand Canyon": 62, "UNLV": 60, "Nevada": 60, "Drake": 60, "Saint Louis": 58, "Loyola Chicago": 58,
    "North Texas": 58, "UAB": 58, "Santa Clara": 58, "San Francisco": 58, "George Mason": 57, "Davidson": 56, "Bradley": 56,
    "Washington State": 55, "Oregon State": 55, "Temple": 55, "Richmond": 54, "Northern Iowa": 54, "Belmont": 54, "Rhode Island": 52,
    "South Florida": 52, "Fresno State": 50, "Tulane": 50, "Charlotte": 49, "Tulsa": 48, "Illinois State": 50, "Murray State": 52,
    "Indiana State": 50, "Southern Illinois": 48, "St. Bonaventure": 52, "Saint Joseph's": 52, "Duquesne": 48, "Hawai'i": 46,
    # decent mid-majors: the 12-14 seeds
    "Liberty": 56, "McNeese": 56, "UC Irvine": 55, "UC San Diego": 54, "High Point": 54, "Akron": 54, "James Madison": 54,
    "Charleston": 54, "South Dakota State": 54, "Vermont": 52, "Furman": 52, "Samford": 52, "Lipscomb": 52, "UNC Wilmington": 52,
    "Oakland": 52, "Colgate": 52, "Iona": 52, "Kent State": 50, "Ohio": 50, "Chattanooga": 50, "Troy": 50, "Arkansas State": 50,
    "Montana": 50, "Oral Roberts": 50, "North Dakota State": 50, "Winthrop": 50, "Saint Peter's": 50, "Middle Tennessee": 50,
    "Western Kentucky": 50, "New Mexico State": 50, "UC Santa Barbara": 50, "Toledo": 48, "Louisiana": 48, "App State": 48,
    "Milwaukee": 48, "Northern Kentucky": 48, "Wright State": 48, "Morehead State": 48, "Florida Gulf Coast": 48, "Sam Houston": 48,
    "Missouri State": 48, "Hofstra": 50, "Northeastern": 46, "Towson": 46, "Long Beach State": 46, "Utah Valley": 46,
    "Eastern Washington": 46, "Weber State": 46, "UNC Asheville": 46, "Longwood": 46, "Kennesaw State": 46, "Jacksonville State": 46,
    "Bucknell": 46, "East Tennessee State": 48, "Marshall": 46, "Abilene Christian": 44, "Norfolk State": 44, "Howard": 44,
    "UC Davis": 44, "Cal Baptist": 44, "Drexel": 44, "Fairleigh Dickinson": 40, "Texas Southern": 40, "Grambling": 38,
    # the Ivies, their own world
    "Yale": 54, "Princeton": 52, "Cornell": 48, "Harvard": 46, "Pennsylvania": 44, "Brown": 40, "Dartmouth": 36, "Columbia": 36,
}


def main():
    rows = [r for r in csv.DictReader(open(os.path.join(SRC, "teams.csv"))) if r["conf"]]
    teams = []
    for r in sorted(rows, key=lambda r: r["name"]):
        mascot = r["full"][len(r["name"]):].strip() or r["full"]
        prest = PRESTIGE.get(r["name"], CONF_BASE[r["conf"]])
        logo = os.path.exists(os.path.join(SRC, "logos", r["id"] + ".png"))
        teams.append([int(r["id"]), r["name"], mascot, r["abbr"], "#" + (r["color"] or "666666"), CONF_NAME[r["conf"]], prest, 1 if logo else 0])
    confs = sorted({t[5] for t in teams})
    with open(os.path.join(OUT, "teams.js"), "w") as f:
        f.write("// Generated by tools/build_teams.py: [espnId, school, mascot, abbr, color, conference, prestige, hasLogo]\n")
        f.write("const TEAMS = " + json.dumps(teams, separators=(",", ":"), ensure_ascii=False) + ";\n")
    print(len(teams), "teams,", len(confs), "conferences,", sum(t[7] for t in teams), "logos")


if __name__ == "__main__":
    main()
