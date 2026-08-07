package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;

/**
 * File-handling helpers for the report-rows download/upload endpoints (.xlsx export, .xlsx bulk-adjustment
 * template, and the re-uploaded spreadsheet) - kept out of {@code CampaignController} so it stays focused
 * on auth, delegation, and mapping.
 */
@Component
public class ReportRowFileSupport {

	/**
	 * Replaces characters that are unsafe in a {@code Content-Disposition} filename or common
	 * filesystems with a hyphen.
	 *
	 * @param value the raw value (e.g. a campaign name)
	 * @return the sanitized value
	 */
	public String fileSafe(String value) {
		return value.replaceAll("[\\\\/:*?\"<>|]", "-");
	}

	/**
	 * Reads an uploaded multipart file's bytes.
	 *
	 * @param file the uploaded file
	 * @return the file's bytes
	 * @throws BusinessException OPH_027 when the file cannot be read
	 */
	public byte[] readBytes(MultipartFile file) {
		try {
			return file.getBytes();
		} catch (IOException e) {
			throw new BusinessException(OperationalHubErrorReason.OPH_027, "could not read the uploaded file");
		}
	}
}
