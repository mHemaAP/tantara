"""Explicit titles used to identify shared reference-library documents."""

from sqlalchemy import func, or_

REFERENCE_LIBRARY_TITLES = (
    "ARBITRATION AND CONCILIATION ACT 1996",
    "Code of Civil Procedure 1908",
    "Code of Civil Procedure, 1908",
    "Specific Relief Act 1963",
    "Specific Relief Act, 1963",
    "Limitation Act",
    "Bharatiya Sakshya Adhiniyam 2023",
    "Bharatiya Sakshya Adhiniyam, 2023",
    "indian contracts act 1872",
    "Information Technology Act 2000",
    "Information Technology Act, 2000",
    "Commercial Courts Act 2015",
    "Commercial Courts Act, 2015",
    "Sale of Goods Act 1930",
    "Sale of Goods Act, 1930",
)

REFERENCE_LIBRARY_TITLE_PREFIXES = ("Relevant state stamp legislation",)


def reference_library_title_predicate(title_column):
    """Match explicit reference titles after normalizing case and outer whitespace."""
    normalized_title = func.lower(func.trim(title_column))
    exact_titles = tuple(title.lower() for title in REFERENCE_LIBRARY_TITLES)
    prefix_matches = tuple(
        normalized_title.like(f"{prefix.lower()}%") for prefix in REFERENCE_LIBRARY_TITLE_PREFIXES
    )
    return or_(normalized_title.in_(exact_titles), *prefix_matches)
