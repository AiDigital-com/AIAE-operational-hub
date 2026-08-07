package com.aidigital.operationalhub.service.netsuite.org;

import com.aidigital.operationalhub.domain.enums.Grade;

/**
 * Result of {@link TitleClassifier#classify(String)}: the organizational role and grade a Rippling
 * {@code title} maps to.
 *
 * @param orgRole           the classified organizational role
 * @param grade             the classified grade
 * @param titleUnrecognized whether the title matched no known pattern (grade defaulted to
 *                          {@link Grade#UNKNOWN})
 */
public record TitleClassification(OrgRole orgRole, Grade grade, boolean titleUnrecognized) {

}
