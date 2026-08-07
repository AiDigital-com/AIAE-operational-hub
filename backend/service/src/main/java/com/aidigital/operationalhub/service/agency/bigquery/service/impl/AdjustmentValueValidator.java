package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;

/**
 * Shared adjustment value checks for inline edits and spreadsheet uploads.
 */
final class AdjustmentValueValidator {

	/**
	 * How far two figures may sit apart and still count as the same one, relative to their own size.
	 *
	 * <p>Roughly nine significant digits: past where a double can disagree with itself, and far short of a
	 * cent on any figure these columns carry.
	 */
	private static final double SAME_VALUE_TOLERANCE = 1e-9;

	private AdjustmentValueValidator() {
	}

	/**
	 * Whether an uploaded figure is the one the row already holds.
	 *
	 * <p>Deliberately not {@code ==}. A baseline figure is read through the view that merges the append-only
	 * adjustments table into the delivery mart, so any figure spanning more than one record is a FLOAT64 sum,
	 * and BigQuery's floating-point addition is order-dependent - two reads of the same unchanged data can
	 * differ in the last bits of the mantissa. Exact equality called that an edit: a bulk upload of a sheet
	 * whose cost column nobody had touched recorded four rows as manually adjusted, each written back with
	 * the value it already held, while 11,244 rows whose figures were exact decimals passed clean.
	 *
	 * <p>The tolerance is relative because these columns carry both fractions of a cent and six-figure sums;
	 * an absolute epsilon small enough for the first is noise on the second, and one large enough for the
	 * second swallows real edits to the first.
	 *
	 * @param baseline the row's current value, or {@code null} when it has none
	 * @param uploaded the value from the sheet
	 * @return {@code true} when the two agree within the tolerance; {@code false} when they differ, and when
	 *     the row holds no value at all - filling an empty figure is an edit, not a match
	 */
	static boolean isSameValue(Double baseline, Double uploaded) {
		if (baseline == null || uploaded == null) {
			return false;
		}
		double scale = Math.max(1.0, Math.max(Math.abs(baseline), Math.abs(uploaded)));
		return Math.abs(baseline - uploaded) <= SAME_VALUE_TOLERANCE * scale;
	}

	static void requireIsoDateCell(String raw, String column, int rowNum) {
		if (raw == null || raw.isBlank()) {
			return;
		}
		requireIsoDate(raw.trim(), "row " + rowNum + ": '" + column + "' must be yyyy-MM-dd");
	}

	static void requireIsoDateValue(String value, String field) {
		requireIsoDate(value, field + " must be yyyy-MM-dd");
	}

	static Long parseOptionalNonNegativeInteger(String raw, String column, int rowNum) {
		Double value = parseOptionalFiniteNumber(raw, column, rowNum);
		if (value == null) {
			return null;
		}
		requireNonNegative(value, column, rowNum);
		if (Math.rint(value) != value) {
			throw new BusinessException(
					OperationalHubErrorReason.OPH_027,
					"row " + rowNum + ": '" + column + "' must be a whole number");
		}
		if (value > Long.MAX_VALUE) {
			throw new BusinessException(
					OperationalHubErrorReason.OPH_027,
					"row " + rowNum + ": '" + column + "' is too large");
		}
		return value.longValue();
	}

	static Double parseOptionalNonNegativeDecimal(String raw, String column, int rowNum) {
		Double value = parseOptionalFiniteNumber(raw, column, rowNum);
		if (value == null) {
			return null;
		}
		requireNonNegative(value, column, rowNum);
		return value;
	}

	static void requireNonNegative(String field, Long value) {
		if (value != null && value < 0) {
			throw new BusinessException(
					OperationalHubErrorReason.OPH_027,
					field + " cannot be negative");
		}
	}

	static void requireFiniteNonNegative(String field, Double value) {
		if (value == null) {
			return;
		}
		if (!Double.isFinite(value)) {
			throw new BusinessException(
					OperationalHubErrorReason.OPH_027,
					field + " must be a finite number");
		}
		if (value < 0) {
			throw new BusinessException(
					OperationalHubErrorReason.OPH_027,
					field + " cannot be negative");
		}
	}

	private static Double parseOptionalFiniteNumber(String raw, String column, int rowNum) {
		if (raw == null || raw.isBlank()) {
			return null;
		}
		try {
			Double value = Double.valueOf(raw.trim());
			if (!Double.isFinite(value)) {
				throw invalidNumber(raw, column, rowNum);
			}
			return value;
		} catch (NumberFormatException ex) {
			throw invalidNumber(raw, column, rowNum);
		}
	}

	private static void requireIsoDate(String value, String message) {
		try {
			LocalDate.parse(value);
		} catch (DateTimeParseException ex) {
			throw new BusinessException(OperationalHubErrorReason.OPH_027, message);
		}
	}

	private static void requireNonNegative(Double value, String column, int rowNum) {
		if (value < 0) {
			throw new BusinessException(
					OperationalHubErrorReason.OPH_027,
					"row " + rowNum + ": '" + column + "' cannot be negative");
		}
	}

	private static BusinessException invalidNumber(String raw, String column, int rowNum) {
		return new BusinessException(
				OperationalHubErrorReason.OPH_027,
				"row " + rowNum + ": '" + column + "' is not a number: '" + raw + "'");
	}
}
