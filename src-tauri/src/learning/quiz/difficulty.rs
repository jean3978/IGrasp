//! The difficulty plan of a generation: how many questions of each level, centred on the level
//! the player starts at (or has reached, for an adaptive round), and the rounds of an adaptive
//! quiz.

/// Questions per round in adaptive mode (the last round takes the remainder).
pub const ROUND_SIZE: u32 = 5;
pub const MIN_LEVEL: u32 = 1;
pub const MAX_LEVEL: u32 = 5;

/// The weight of a level `d` away from the centre: the level itself and the next harder one
/// weigh most, so a quiz pulls the player up a little.
fn weight(d: i64) -> f64 {
    match d {
        0 => 3.0,
        1 => 2.6,
        -1 => 2.2,
        2 | -2 => 1.0,
        _ => 0.5,
    }
}

/// Questions per level (index 0 is level 1) for `count` questions centred on `level`: sums to
/// `count`, never zero at `level` (when `count > 0`), and decreasing away from it.
pub fn plan(count: u32, level: u32) -> [u32; 5] {
    let level = level.clamp(MIN_LEVEL, MAX_LEVEL);
    let mut out = [0u32; 5];
    if count == 0 {
        return out;
    }
    let weights: Vec<f64> = (1..=5)
        .map(|l| weight(i64::from(l) - i64::from(level)))
        .collect();
    let total: f64 = weights.iter().sum();
    // Largest remainder: floors first, then the rest by remainder (closest to the centre first
    // on ties).
    let exact: Vec<f64> = weights
        .iter()
        .map(|w| w * f64::from(count) / total)
        .collect();
    let mut given = 0;
    for (i, e) in exact.iter().enumerate() {
        // `e` is small and positive: the cast is exact after `floor`.
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let floor = e.floor() as u32;
        out[i] = floor;
        given += floor;
    }
    let mut order: Vec<usize> = (0..5).collect();
    order.sort_by(|&a, &b| {
        let ra = exact[a] - exact[a].floor();
        let rb = exact[b] - exact[b].floor();
        rb.total_cmp(&ra).then_with(|| {
            let da = (a as i64 + 1 - i64::from(level)).abs();
            let db = (b as i64 + 1 - i64::from(level)).abs();
            da.cmp(&db)
        })
    });
    for i in order.into_iter().cycle().take((count - given) as usize) {
        out[i] += 1;
    }
    let centre = (level - 1) as usize;
    if out[centre] == 0 {
        // Small counts: take one from the farthest non-empty level.
        if let Some(far) = (0..5)
            .filter(|&i| out[i] > 0)
            .max_by_key(|&i| (i as i64 - centre as i64).abs())
        {
            out[far] -= 1;
            out[centre] += 1;
        }
    }
    out
}

/// "2 of difficulty 1, 3 of difficulty 2, …" (the prompt's form).
pub fn plan_text(plan: &[u32; 5]) -> String {
    plan.iter()
        .enumerate()
        .filter(|(_, n)| **n > 0)
        .map(|(i, n)| format!("{n} of difficulty {}", i + 1))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Rounds of an adaptive quiz of `count` questions.
pub fn rounds(count: u32) -> u32 {
    count.div_ceil(ROUND_SIZE).max(1)
}

/// Questions of round `number` (1-based) of a quiz of `count` questions.
pub fn round_size(count: u32, number: u32) -> u32 {
    let before = ROUND_SIZE * number.saturating_sub(1);
    count.saturating_sub(before).min(ROUND_SIZE)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plans_sum_to_the_count_and_centre_on_the_level() {
        for count in 1..=30 {
            for level in 1..=5 {
                let p = plan(count, level);
                assert_eq!(p.iter().sum::<u32>(), count, "{count} at {level}: {p:?}");
                assert!(p[(level - 1) as usize] > 0, "{count} at {level}: {p:?}");
                // Decreasing away from the centre, by at most one of rounding.
                let c = (level - 1) as usize;
                for i in 0..5usize {
                    for j in 0..5usize {
                        let (di, dj) = (i.abs_diff(c), j.abs_diff(c));
                        if di + 1 < dj {
                            assert!(p[i] + 1 >= p[j], "{count} at {level}: {p:?}");
                        }
                    }
                }
            }
        }
        assert_eq!(plan(10, 2), [2, 3, 3, 1, 1]);
        assert_eq!(plan(0, 3), [0; 5]);
    }

    #[test]
    fn plan_text_and_rounds() {
        assert_eq!(
            plan_text(&[2, 3, 0, 0, 1]),
            "2 of difficulty 1, 3 of difficulty 2, 1 of difficulty 5"
        );
        assert_eq!(rounds(10), 2);
        assert_eq!(rounds(12), 3);
        assert_eq!(rounds(3), 1);
        assert_eq!(round_size(12, 1), 5);
        assert_eq!(round_size(12, 3), 2);
        assert_eq!(round_size(12, 4), 0);
    }
}
