package com.aidigital.operationalhub.service.agency.bigquery.model;

import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Typed accessor over a single BigQuery result row (a column-name → value map), so row mappers read
 * values without repeating the {@code null}/number/string conversion logic.
 *
 * @param values the raw column values keyed by column name
 */
public record BqRow(Map<String, Object> values) {

	/**
	 * Returns the column value as a {@code Long}, or {@code null} when absent or not numeric.
	 *
	 * @param column the column name
	 * @return the long value, or {@code null}
	 */
	public Long getLong(String column) {
		Object value = values.get(column);
		if (value == null) {
			return null;
		}
		if (value instanceof Number number) {
			return number.longValue();
		}
		try {
			return Long.valueOf(value.toString());
		} catch (NumberFormatException ex) {
			return null;
		}
	}

	/**
	 * Returns the column value as a {@code Boolean}, or {@code null} when absent. Used for an aggregate
	 * boolean result such as {@code LOGICAL_OR(...)} - BigQuery's REST response surfaces every scalar
	 * value as its string form, so a raw {@code "true"}/{@code "false"} is parsed the same way a raw
	 * numeric string is in {@link #getLong} and {@link #getDouble}.
	 *
	 * @param column the column name
	 * @return the boolean value, or {@code null}
	 */
	public Boolean getBoolean(String column) {
		Object value = values.get(column);
		if (value == null) {
			return null;
		}
		if (value instanceof Boolean bool) {
			return bool;
		}
		return Boolean.parseBoolean(value.toString());
	}

	/**
	 * Returns the column value as a {@code Double}, or {@code null} when absent or not numeric.
	 *
	 * @param column the column name
	 * @return the double value, or {@code null}
	 */
	public Double getDouble(String column) {
		Object value = values.get(column);
		if (value == null) {
			return null;
		}
		if (value instanceof Number number) {
			return number.doubleValue();
		}
		try {
			return Double.valueOf(value.toString());
		} catch (NumberFormatException ex) {
			return null;
		}
	}

	/**
	 * Returns the column value as a {@code String}, or {@code null} when absent.
	 *
	 * @param column the column name
	 * @return the string value, or {@code null}
	 */
	public String getString(String column) {
		Object value = values.get(column);
		return value == null ? null : value.toString();
	}

	/**
	 * Returns the column value as a trimmed {@code String}, or {@code null} when absent or blank.
	 *
	 * @param column the column name
	 * @return the trimmed string value, or {@code null}
	 */
	public String getTrimmedString(String column) {
		String value = getString(column);
		if (value == null) {
			return null;
		}
		String trimmed = value.trim();
		return trimmed.isEmpty() ? null : trimmed;
	}

	/**
	 * Returns the column value (a BigQuery {@code ARRAY}) as a list of strings, never {@code null}.
	 *
	 * @param column the column name
	 * @return the string list, empty when the column is absent or not an array
	 */
	public List<String> getStringList(String column) {
		Object value = values.get(column);
		if (value instanceof List<?> list) {
			return list.stream()
					.filter(Objects::nonNull)
					.map(Object::toString)
					.toList();
		}
		return List.of();
	}
}
